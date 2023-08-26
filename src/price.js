const Logger = require('log4js')
const { EventEmitter } = require('events')
const logger = Logger.getLogger()

const lock = () => {
  const locked = {}
  const eventEmitter = new EventEmitter()
  eventEmitter.setMaxListeners(0)

  return {
    acquire: (key) => {
      return new Promise((resolve) => {
        if (!locked[key]) {
          locked[key] = true
          resolve()
          return
        }

        const tryAcquire = () => {
          if (!locked[key]) {
            locked[key] = true
            eventEmitter.removeListener(key, tryAcquire)
            resolve()
          }
        }

        eventEmitter.on(key, tryAcquire)
      })
    },
    release: (key) => {
      delete locked[key]
      setImmediate(() => eventEmitter.emit(key))
    },
  }
}

const mutex = lock()
const priceCache = {}

const fetchPrice = async (token) => {
  await mutex.acquire(token)

  if (priceCache[token]) {
    mutex.release(token)
    return priceCache[token]
  }

  try {
    let ret = 0
    const r = await fetch(
      `https://api.portals.fi/v2/tokens?networks=optimism&ids=optimism:${token}`,
      {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'PostmanRuntime/7.22.0',
        },
      },
    )
    const res = await r.json()
    ret = res.tokens[0].price
    logger.debug(`fetch token ${token}: ${ret}`)
    priceCache[token] = ret
  } catch (e) {
    console.error(e)
  } finally {
    mutex.release(token)
  }

  return priceCache[token]
}

module.exports = fetchPrice
