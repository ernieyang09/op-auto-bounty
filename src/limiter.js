const Logger = require('log4js')
const logger = Logger.getLogger()

const limit = async (tasks, concurrency) => {
  const result = new Array(tasks)
  const runTask = async (taskIterator) => {
    for (const [idx, task] of taskIterator) {
      try {
        logger.debug(idx)
        const res = await task()
        result[idx] = res
      } catch (e) {
        console.error(`${idx} failed`)
      }
    }
  }

  const taskIterator = tasks.entries()

  const workers = new Array(concurrency).fill(taskIterator).map(runTask)

  await Promise.allSettled(workers)

  return result
}

module.exports = limit
