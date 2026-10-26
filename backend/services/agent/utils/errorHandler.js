// Last Express middleware: known errors (e.g. 429 from checkAgentLimit) keep
// their status and payload, anything else becomes a 500.
export const errorHandler = (err, req, res, next) => {
    console.log(err)

    if (err?.status) {
        return res.status(err.status).json(err.data ?? { message: err.message })
    }

    return res.status(500).json({ message: `agent error ${err?.message ?? err}` })
}
