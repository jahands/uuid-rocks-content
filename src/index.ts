import { Hono } from 'hono'
import mime from 'mime'
import pRetry from 'p-retry'
import { App } from './types'

const app = new Hono<App>()
	.get('*', async (c) => {
		const kvPath = `uuid-rocks-content/IMAGES${c.req.path}`
		const r2Path = `IMAGES${c.req.path}`
		const fileExtension = c.req.path.split('.').pop() || ''

		// Check KV cache
		const kvRes = await pRetry(
			async () => {
				const res = await c.env.KV.getWithMetadata(kvPath, { type: 'stream' })
				return res
			},
			{
				retries: 3,
				randomize: true,
			}
		)
		if (kvRes.value) {
			const meta = kvRes.metadata as any
			const contentType = (meta?.headers['content-type'] as string) || mime.getType(fileExtension) || 'application/octet-stream'
			if (meta?.headers['content-length']) {
				c.res.headers.set('Content-Length', meta.headers['content-length'])
			}
			console.log('KV cache hit')
			return c.body(kvRes.value, 200, {
				'Content-Type': contentType,
				'Cache-Control': 'public, max-age=2592000, immutable', // 30 days
			})
		}

		// Fall back to R2
		const r2Res = await pRetry(
			async () => {
				const res = await c.env.R2.get(r2Path)
				return res
			},
			{
				retries: 3,
				randomize: true,
			}
		)
		if (!r2Res) {
			return c.body('not found', 404, {
				'Content-Type': 'text/plain',
				'Cache-Control': 'public, max-age=3600', // 1 hour
			})
		}

		const contentType = r2Res.httpMetadata?.contentType || mime.getType(fileExtension) || 'application/octet-stream'
		if (r2Res.size > 0) {
			c.res.headers.set('Content-Length', r2Res.size.toString())
		}

		// Cache in KV
		const body = await r2Res.arrayBuffer()
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

		console.log('R2 hit')

		return c.body(body, 200, {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=2592000, immutable', // 30 days
		})
	})
	.onError((err, c) => {
		console.error(err)
		return c.text('internal server error', 500, {
			'Content-Type': 'text/plain',
		})
	})

export default app
