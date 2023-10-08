import { Hono } from 'hono'
import { App } from './types'
import { useAxiomLogger, useCFTraceMiddleware } from './middleware'
import { getFromStorage } from './routes'

declare const ENVIRONMENT: 'production' | undefined

const app = new Hono<App>()
	.use('*', useCFTraceMiddleware<App>(ENVIRONMENT))
	.use('*', useAxiomLogger<App>(ENVIRONMENT))
	.get('*', getFromStorage)
	.onError((err, c) => {
		c.get('logger').error(err)
		return c.text('internal server error', 500, {
			'Content-Type': 'text/plain',
		})
	})

export default app
