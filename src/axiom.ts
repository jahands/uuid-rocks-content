export type AxiomTags = { [key: string]: string | number | boolean | null | object }
export type AxiomLog = {
	_time: string
	message: string
	tags?: AxiomTags
	data?: {
		/**
		 * If provided, will be JSON.stringify'd to
		 * save field counts in Axiom */
		msc?: any
		[key: string]: any
	}
}

export class AxiomLogger {
	private readonly ctx: ExecutionContext
	private readonly axiomApiKey
	private readonly dataset
	private readonly tags

	// Axiom stuff
	private readonly logs: AxiomLog[] = []
	private flushTimeout: any | null = null
	private flushPromise: Promise<any> | null = null
	private flushAfterMs
	private flushAfterLogs

	constructor({
		ctx,
		axiomApiKey,
		tags,
		dataset,
		flushAfterMs,
		flushAfterLogs,
	}: {
		ctx: ExecutionContext
		axiomApiKey: string
		tags: AxiomTags
		dataset: string
		flushAfterMs?: number
		flushAfterLogs?: number
	}) {
		this.ctx = ctx
		this.axiomApiKey = axiomApiKey
		this.dataset = dataset
		this.tags = tags
		this.flushAfterMs = flushAfterMs ?? 10000
		this.flushAfterLogs = flushAfterLogs ?? 100
	}

	private _log(message: string, level: string, data?: any): void {
		if (data && data.level) {
			level = data.level
			delete data.level
		}

		// Convert errors cause I think they weren't stringifying correctly
		if (data && data.error && data.error && data.error.message) {
			data.error = {
				message: data.error.message,
				stack: data.error.stack,
			}
		}

		// Stringify msc to save field counts in Axiom
		if (data && data.msc && typeof data.msc !== 'string') {
			data.msc = JSON.stringify(data.msc)
		}

		this.logs.push({
			_time: new Date().toISOString(),
			message,
			tags: {
				...this.tags,
				level,
			},
			data,
		})

		if (this.logs.length >= this.flushAfterLogs) {
			// Reset scheduled if there is one
			if (this.flushTimeout) {
				this.scheduleFlush(this.flushAfterMs, true)
			}
			this.ctx.waitUntil(this.flush({ skipIfInProgress: true }))
		} else {
			// Always schedule a flush (if there isn't one already)
			this.scheduleFlush(this.flushAfterMs)
		}
	}

	/** Flush after X ms if there's not already
	 * a flush scheduled
	 * @param reset If true, cancel the current flush timeout
	 */
	scheduleFlush(timeout: number, reset = false): void {
		if (reset && this.flushTimeout) {
			clearTimeout(this.flushTimeout)
			this.flushTimeout = null
		}

		if (!this.flushTimeout && !this.flushPromise) {
			this.flushTimeout = setTimeout(() => {
				const doFlush = async (): Promise<void> => {
					this.flush({ skipIfInProgress: true })
					this.flushTimeout = null
				}
				this.ctx.waitUntil(doFlush())
			}, timeout)
		}
	}

	async flush({ skipIfInProgress = false }: { skipIfInProgress?: boolean } = {}): Promise<void> {
		if (skipIfInProgress && this.flushPromise) return

		const doFlush = async (): Promise<void> => {
			if (this.logs.length === 0) return // Nothing to do

			try {
				const logsCount = this.logs.length
				const logsBody = JSON.stringify(this.logs)
				const res = await fetch(`https://api.axiom.co/v1/datasets/${this.dataset}/ingest`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${this.axiomApiKey}`,
					},
					body: logsBody,
				})
				if (res.ok) {
					// Remove the logs we sent
					this.logs.splice(0, logsCount)
				}
			} catch (err) {
				console.error('Error sending logs to Axiom:', err)
			}
		}

		// Make sure the last one is done before starting a new one
		// this shouldn't happen, but just to be safe...
		await this.flushPromise

		this.flushPromise = doFlush()
		await this.flushPromise
		this.flushPromise = null
	}

	log(msg: string, data?: any): void {
		this._log(msg, 'info', data)
	}

	info(msg: string, data?: any): void {
		this._log(msg, 'info', data)
	}

	warn(msg: string, data?: any): void {
		this._log(msg, 'warning', data)
	}

	error(msg: string | Error, data?: any): void {
		const m: string = msg instanceof Error ? msg.message + (msg.stack ? `\n${msg.stack}` : '') : msg
		this._log(m, 'error', data)
	}

	debug(msg: string, data?: any): void {
		this._log(msg, 'debug', data)
	}
}
