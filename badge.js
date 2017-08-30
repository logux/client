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
 * @param {object} options.styles.wait Styles for wait state.
 * @param {object} options.styles.connecting Styles for connecting state.
 * @param {object} options.styles.sending Styles for sending state.
 * @param {object} options.styles.error Error styles.
 * @param {object} options.styles.protocolError Protocol error styles.
 * @param {object} options.styles.icons Icons in URL link or `data:uri`.
 * @param {string} options.styles.icons.synchronized Synchronized state.
 * @param {string} options.styles.icons.disconnected Disconnected state.
 * @param {string} options.styles.icons.wait Wait state.
 * @param {string} options.styles.icons.sending Sending state.
 * @param {string} options.styles.icons.error Error state.
 * @param {string} options.styles.icons.protocolError Protocol error state.
 * @param {object} options.messages Widget text for different states.
 * @param {object} options.messages.synchronized Text for synchronized state.
 * @param {object} options.messages.disconnected Text for disconnected state.
 * @param {object} options.messages.wait Text for wait state.
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
  var styles = options.styles

  var widget = document.createElement('div')
  var text = document.createElement('span')

  injectStyles(widget, RESET)
  injectStyles(widget, styles.base)
  injectStyles(text, styles.text)
  setPosition(widget, position)

  var unbind = status(client, function (state) {
    if (state === 'sendingAfterWait' || state === 'connectingAfterWait') {
      injectStyles(widget, styles.sending)
      text.innerHTML = messages.sending
      show(widget)
    } else if (state === 'synchronizedAfterWait') {
      injectStyles(widget, styles.synchronized)
      text.innerHTML = messages.synchronized
      show(widget)
    } else if (state === 'synchronized') {
      hide(widget)
    } else if (state === 'disconnected') {
      injectStyles(widget, styles.disconnected)
      text.innerHTML = messages.disconnected
      show(widget)
    } else if (state === 'wait') {
      injectStyles(widget, styles.wait)
      text.innerHTML = messages.wait
      show(widget)
    } else if (state === 'protocolError') {
      injectStyles(widget, styles.protocolError)
      text.innerHTML = messages.protocolError
      show(widget)
    } else if (state === 'syncError') {
      injectStyles(widget, styles.error)
      text.innerHTML = messages.syncError
      show(widget)
    } else if (state === 'error') {
      injectStyles(widget, styles.error)
      text.innerHTML = messages.error
      show(widget)
    } else if (state === 'denied') {
      injectStyles(widget, styles.error)
      text.innerHTML = messages.denied
      show(widget)
    }
  }, options)

  widget.appendChild(text)
  document.body.appendChild(widget)

  return function () {
    unbind()
    document.body.removeChild(widget)
  }
}

module.exports = badge
