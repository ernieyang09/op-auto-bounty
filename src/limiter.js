const limit = async (tasks, concurrency) => {

  const result = new Array(tasks)

  const runTask = async (taskIterator) => {

    for (const [idx, task] of taskIterator) {
      try {
        const res = await task()
        result[idx] = res
      } catch(e) {
        console.log(e)
      }
    }
  }

  const taskIterator = tasks.entries()

  const workers = new Array(concurrency).fill(taskIterator).map(runTask)

  await Promise.allSettled(workers)


  return result

}

module.exports = limit
