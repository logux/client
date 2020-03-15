let { status } = require('../status')

function injectStyles (element, styles) {
  for (let i in styles) {
    element.style[i] = styles[i]
  }
}

function setPosition (element, position) {
  let style = element.style
  if (position === 'middle-center' || position === 'center-middle') {
    style.top = '50%'
    style.left = '50%'
    style.transform = 'translate(-50%, -50%)'
  } else {
    position.split('-').forEach(pos => {
      if (pos === 'middle') {
        style.top = '50%'
        style.transform = 'translateY(-50%)'
      } else if (pos === 'center') {
        style.left = '50%'
        style.transform = 'translateX(-50%)'
      } else {
        style[pos] = '0'
      }
    })
  }
}

const RESET = {
  boxSizing: 'content-box',
  visibility: 'visible',
  textIndent: '0',
  textTransform: 'none',
  wordSpacing: 'normal',
  letterSpacing: 'normal',
  fontStyle: 'normal',
  fontVariant: 'normal',
  fontWeight: 'normal',
  lineHeight: 'auto'
}

function badge (client, opts) {
  let messages = opts.messages
  let position = opts.position || 'bottom-right'
  let styles = opts.styles

  let widget = document.createElement('div')
  let text = document.createElement('span')

  widget.setAttribute('role', 'alert')

  injectStyles(widget, RESET)
  injectStyles(widget, styles.base)
  injectStyles(text, styles.text)
  setPosition(widget, position)

  let show = (style, msg) => {
    text.innerHTML = msg
    injectStyles(widget, style)
    widget.style.display = 'block'
  }

  let hide = () => {
    widget.style.display = 'none'
  }

  let unbind = status(client, state => {
    if (state === 'sendingAfterWait' || state === 'connectingAfterWait') {
      show(styles.sending, messages.sending)
    } else if (state === 'synchronizedAfterWait') {
      show(styles.synchronized, messages.synchronized)
    } else if (state === 'synchronized') {
      hide(widget)
    } else if (state === 'disconnected') {
      show(styles.disconnected, messages.disconnected)
    } else if (state === 'wait') {
      show(styles.wait, messages.wait)
    } else if (state === 'protocolError') {
      show(styles.protocolError, messages.protocolError)
    } else if (state === 'syncError') {
      show(styles.error, messages.syncError)
    } else if (state === 'error') {
      show(styles.error, messages.error)
    } else if (state === 'denied') {
      show(styles.error, messages.denied)
    }
  }, opts)

  widget.appendChild(text)
  document.body.appendChild(widget)

  return () => {
    unbind()
    document.body.removeChild(widget)
  }
}

let badgeRu = {
  synchronized: 'Ваши данные сохранены',
  disconnected: 'Нет интернета',
  wait: 'Нет интернета<br>Ваши данные не сохранены',
  sending: 'Сохраняю ваши данные',
  syncError: 'Ошибка на сервере<br>Ваши данные не сохранены',
  error: 'Ошибка на сервере<br>Ваши действия отменены',
  denied: 'Нет прав<br>Ваши действия отменены',
  protocolError: 'Сохранение не работает<br>Обновите страницу'
}

let badgeEn = {
  synchronized: 'Your data has been saved',
  disconnected: 'No Internet connection',
  wait: 'No Internet connection<br>Your data has not been saved',
  sending: 'Data saving',
  syncError: 'Server error<br>Your data has not been saved',
  error: 'Server error<br>You changes was reverted',
  denied: 'You have no access<br>You changes was reverted',
  protocolError: 'Saving is not working<br>Refresh the page'
}

module.exports = { badge, badgeEn, badgeRu }
