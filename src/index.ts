import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { App } from './types'
import { useAxiomLogger, useCFTraceMiddleware, useHostnameMiddleware } from './middleware'
import { getFromStorage } from './routes'

declare const ENVIRONMENT: 'production' | undefined

const app = new Hono<App>()
	.use('*', useCFTraceMiddleware<App>(ENVIRONMENT))
	.use('*', useAxiomLogger<App>(ENVIRONMENT))
	.use('*', useHostnameMiddleware)
	.get('*', async (c) => {
		switch (c.get('host')) {
			case 'i.uuid.rocks':
				return getFromStorage(c, 'IMAGES')
			case 'dl.uuid.rocks':
				return getFromStorage(c, 'DOWNLOADS')
			default:
				throw new HTTPException(400, { message: 'bad request' })
		}
	})
	.onError((err, c) => {
		if (err instanceof HTTPException) {
			return err.getResponse()
		}

		c.get('logger').error(err)
		return c.text('internal server error', 500, {
			'Content-Type': 'text/plain',
		})
	})
	.notFound((c) => {
		return c.text('not found', 404, {
			'Content-Type': 'text/plain',
		})
	})

export default app
