var status = require('./status')

function show (element) {
  element.style.display = 'block'
}

function hide (element) {
  element.style.display = 'none'
}

function injectStyles (element, styles) {
  for (var property in styles) {
    element.style[property] = styles[property]
  }
}

function setPosition (element, position) {
  var parsePosition = position.split('-')
  parsePosition.forEach(function (pos) {
    switch (pos) {
      case 'top':
        element.style.top = '0'
        break
      case 'middle':
        element.style.top = '50%'
        element.style.transform = 'translateY(-50%)'
        break
      case 'bottom':
        element.style.bottom = '0'
        break
      case 'left':
        element.style.left = '0'
        break
      case 'center':
        element.style.left = '50%'
        element.style.transform = 'translateX(-50%)'
        break
      case 'right':
        element.style.right = '0'
        break
    }
  })
  if (position === 'middle-center' || position === 'center-middle') {
    element.style.top = '50%'
    element.style.left = '50%'
    element.style.transform = 'translate(-50%, -50%)'
  }
}

var RESET = {
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

/**
 * Display Logux widget in browser.
 *
 * @param {Syncable|Client} client Observed Client instance
 *                                 or object with `sync` property.
 * @param {object} options Widget settings.
 * @param {object} options.styles Inline styles for different states.
 * @param {object} options.styles.base Base styles.
 * @param {object} options.styles.text Style for text element inside widget.
 * @param {object} options.styles.synchronized Styles for synchronized state.
 * @param {object} options.styles.disconnected Styles for disconnected state.
 * @param {object} options.styles.waitSync Styles for wait state.
 * @param {object} options.styles.connecting Styles for connecting state.
 * @param {object} options.styles.sending Styles for sending state.
 * @param {object} options.styles.error Error styles.
 * @param {object} options.styles.protocolError Protocol error styles.
 * @param {object} options.styles.icons Icons in URL link or `data:uri`.
 * @param {string} options.styles.icons.synchronized Synchronized state.
 * @param {string} options.styles.icons.disconnected Disconnected state.
 * @param {string} options.styles.icons.waitSync Wait state.
 * @param {string} options.styles.icons.sending Sending state.
 * @param {string} options.styles.icons.error Error state.
 * @param {string} options.styles.icons.protocolError Protocol error state.
 * @param {object} options.messages Widget text for different states.
 * @param {object} options.messages.synchronized Text for synchronized state.
 * @param {object} options.messages.disconnected Text for disconnected state.
 * @param {object} options.messages.waitSync Text for wait state.
 * @param {object} options.messages.sending Text for sending state.
 * @param {object} options.messages.syncError Logux error text.
 * @param {object} options.messages.error Error text.
 * @param {object} options.messages.denied Denied text.
 * @param {object} options.messages.protocolError Protocol error text.
 * @param {string} [options.position="bottom-right"] Widget position.
 * @param {number} [options.duration=3000] Synchronized state duration.
 *
 * @return {Function} Unbind badge listener and remove widget from DOM.
 *
 * @example
 * import badge from 'logux-status/badge'
 * import messages from 'logux/status/badge/en'
 * import styles from 'logux/status/badge/default'
 *
 * badge(client, {
 *  messages: messages,
 *  styles: {
 *    ...styles,
 *    synchronized: { backgroundColor: 'green' }
 *  },
 *  position: 'top-left'
 * })
 */
function badge (client, options) {
  var messages = options.messages
  var position = options.position || 'bottom-right'
  var duration = options.duration || 3000
  var styles = options.styles

  var widget = document.createElement('div')
  var text = document.createElement('span')

  injectStyles(widget, RESET)
  injectStyles(widget, styles.base)
  injectStyles(text, styles.text)
  setPosition(widget, position)

  var waiting = false

  var unbind = status(client, function (state) {
    if (state === 'sendingAfterWait' || state === 'connectingAfterWait') {
      injectStyles(widget, styles.sending)
      show(widget)
      text.innerHTML = messages.sending
      waiting = true
    } else if (state === 'synchronized') {
      injectStyles(widget, styles.synchronized)
      if (waiting) {
        waiting = false
        show(widget)
        text.innerHTML = messages.synchronized
        setTimeout(function () {
          hide(widget)
        }, duration)
      } else {
        hide(widget)
      }
    } else if (state === 'disconnected') {
      injectStyles(widget, styles.disconnected)
      show(widget)
      text.innerHTML = messages.disconnected
    } else if (state === 'waitSync') {
      injectStyles(widget, styles.waitSync)
      show(widget)
      text.innerHTML = messages.waitSync
      waiting = true
    } else if (state === 'protocolError') {
      show(widget)
      text.innerHTML = messages.protocolError
      injectStyles(widget, styles.protocolError)
    } else if (state === 'syncError') {
      show(widget)
      text.innerHTML = messages.syncError
      injectStyles(widget, styles.error)
    } else if (state === 'error') {
      text.innerHTML = messages.error
      injectStyles(widget, styles.error)
      show(widget)
    } else if (state === 'denied') {
      text.innerHTML = messages.denied
      injectStyles(widget, styles.error)
      show(widget)
    }
  })

  widget.appendChild(text)
  document.body.appendChild(widget)

  return function () {
    unbind()
    document.body.removeChild(widget)
  }
}

module.exports = badge
