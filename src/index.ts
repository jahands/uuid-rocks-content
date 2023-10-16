import { Hono } from 'hono'
import { App } from './types'
import { useAxiomLogger, useCFTraceMiddleware } from './middleware'
import { getFromStorage, getFromStorageNoCache } from './routes'

declare const ENVIRONMENT: 'production' | undefined

const app = new Hono<App>()
	.use('*', useCFTraceMiddleware<App>(ENVIRONMENT))
	.use('*', useAxiomLogger<App>(ENVIRONMENT))
	.get('*', async (c) => {
		const host = new URL(c.req.url).host
		switch (host) {
			case 'i.uuid.rocks':
				return getFromStorage(c)
			case 'dl.uuid.rocks':
				return getFromStorageNoCache(c)
			default:
				return c.notFound()
		}
	})
	.onError((err, c) => {
		c.get('logger').error(err)
		return c.text('internal server error', 500, {
			'Content-Type': 'text/plain',
		})
	})

export default app
