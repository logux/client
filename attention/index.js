export function attention(client) {
  let doc = document
  let originTitle = false
  let unbind = []
  let timeout = false

  let restoreTitle = () => {
    if (originTitle) {
      doc.title = originTitle
      originTitle = false
    }
  }

  let blink = () => {
    if (doc.hidden && !originTitle) {
      originTitle = doc.title
      doc.title = '* ' + doc.title
    } else {
      restoreTitle()
    }

    if (doc.hidden) timeout = setTimeout(blink, 1000)
  }

  let tabListener = () => {
    if (!doc.hidden && timeout) {
      timeout = clearTimeout(timeout)
      restoreTitle()
    }
  }

  if (doc && typeof doc.hidden !== 'undefined') {
    unbind.push(
      client.node.on('error', error => {
        if (error.type !== 'timeout' && !timeout) {
          blink()
        }
      })
    )

    unbind.push(
      client.on('add', action => {
        if (action.type === 'logux/undo' && action.reason && !timeout) {
          blink()
        }
      })
    )

    document.addEventListener('visibilitychange', tabListener, false)
    unbind.push(() => {
      document.removeEventListener('visibilitychange', tabListener, false)
    })
  }

  return () => {
    for (let i of unbind) i()
  }
}
