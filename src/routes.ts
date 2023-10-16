import { Context } from 'hono'
import mime from 'mime'
import pRetry from 'p-retry'
import { App } from './types'

export async function getFromStorage(c: Context<App>, storagePrefix: string): Promise<Response> {
	const kvPath = `uuid-rocks-content/${storagePrefix}${c.req.path}`
	const r2Path = `${storagePrefix}${c.req.path}`
	const fileExtension = c.req.path.split('.').pop() || ''
	let response: Response | undefined
	const cache = caches.default

	c.set('kvHit', false)
	c.set('r2Hit', false)
	c.set('cacheHit', false)

	const cachedResponse = await cache.match(c.req.raw)
	if (cachedResponse) {
		c.set('cacheHit', true)
		return cachedResponse
	}

	let useCacheAPI = false

	// Check KV cache
	const kvRes = await pRetry(
		async () => {
			const res = await c.env.KV.getWithMetadata(kvPath, { type: 'stream', cacheTtl: 604800 }) // 7 days
			return res
		},
		{
			retries: 3,
			randomize: true,
			onFailedAttempt: (err) => {
				c.get('logger').error(`KV read failed: ${err.message}`, {
					attemptNumber: err.attemptNumber,
					retriesLeft: err.retriesLeft,
					error: err,
				})
			},
		}
	)

	if (kvRes.value) {
		c.set('kvHit', true)
		useCacheAPI = true // If we can store it in KV, it's small enough for cache

		const meta = kvRes.metadata as any
		const contentType = (meta?.headers['content-type'] as string) || mime.getType(fileExtension) || 'application/octet-stream'
		if (meta?.headers['content-length']) {
			c.header('Content-Length', meta.headers['content-length'])
		}

		response = c.body(kvRes.value, 200, {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=3600, immutable', // 1 hour
		})
	} else {
		// Fall back to R2
		const r2Res = await pRetry(
			async () => {
				const res = await c.env.R2.get(r2Path)
				return res
			},
			{
				retries: 3,
				randomize: true,
				onFailedAttempt: (err) => {
					c.get('logger').error(`R2 read failed: ${err.message}`, {
						attemptNumber: err.attemptNumber,
						retriesLeft: err.retriesLeft,
						error: err,
					})
				},
			}
		)

		if (r2Res) {
			c.set('r2Hit', true)

			const contentType = r2Res.httpMetadata?.contentType || mime.getType(fileExtension) || 'application/octet-stream'
			if (r2Res.size > 0) {
				c.header('Content-Length', r2Res.size.toString())
				if (r2Res.size <= 512 * 1000 * 1000) {
					// Cache files within the limits for cache API
					useCacheAPI = true
				}
			}

			const body = await r2Res.arrayBuffer()
			// Cache in KV if it's within 25MiB
			if (r2Res.size <= 25 * 1024 * 1024) {
				c.executionCtx.waitUntil(
					c.env.KV.put(kvPath, body, {
						expirationTtl: 2592000, // 30 days
						metadata: {
							headers: {
								'content-type': contentType,
								'content-length': r2Res.size.toString(),
							},
						},
					})
				)
			} else {
				c.get('logger').info('Not caching in KV because size is too big')
			}

			response = c.body(body, 200, {
				'Content-Type': contentType,
				'Cache-Control': 'public, max-age=3600, s-max-age=3600', // 1 hour
			})
		}
	}

	if (!response) {
		// Always cache 404s
		c.header('Cache-Control', 'public, max-age=60, s-max-age=600')
		response = await c.notFound()
		c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()))
	} else if (useCacheAPI) {
		// Cache files if under the limit for cache (if we were able to determine size)
		c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()))
	}

	return response
}
