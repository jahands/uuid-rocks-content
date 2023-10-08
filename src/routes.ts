import { Context } from 'hono'
import mime from 'mime'
import pRetry from 'p-retry'
import { App } from './types'

export async function getFromStorage(c: Context<App, '*'>): Promise<Response> {
	const kvPath = `uuid-rocks-content/IMAGES${c.req.path}`
	const r2Path = `IMAGES${c.req.path}`
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
		const meta = kvRes.metadata as any
		const contentType = (meta?.headers['content-type'] as string) || mime.getType(fileExtension) || 'application/octet-stream'
		if (meta?.headers['content-length']) {
			c.header('Content-Length', meta.headers['content-length'])
		}
		console.log('KV cache hit')
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
				'Cache-Control': 'public, max-age=3600, immutable', // 1 hour
			})
		}
	}

	if (!response) {
		c.header('Cache-Control', 'public, max-age=60, s-max-age=600')
		response = await c.notFound()
	}

	c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()))

	return response
}
