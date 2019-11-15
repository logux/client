var status = require('./status')

function injectStyles (element, styles) {
  for (var i in styles) {
    element.style[i] = styles[i]
  }
}

function setPosition (element, position) {
  var style = element.style
  if (position === 'middle-center' || position === 'center-middle') {
    style.top = '50%'
    style.left = '50%'
    style.transform = 'translate(-50%, -50%)'
  } else {
    position.split('-').forEach(function (pos) {
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
 * @param {Client} client Observed Client instance.
 * @param {object} opts Widget settings.
 * @param {object} opts.styles Inline styles for different states.
 * @param {object} opts.styles.base Base styles.
 * @param {object} opts.styles.text Style for text element inside widget.
 * @param {object} opts.styles.synchronized Styles for synchronized state.
 * @param {object} opts.styles.disconnected Styles for disconnected state.
 * @param {object} opts.styles.wait Styles for wait state.
 * @param {object} opts.styles.connecting Styles for connecting state.
 * @param {object} opts.styles.sending Styles for sending state.
 * @param {object} opts.styles.error Error styles.
 * @param {object} opts.styles.protocolError Protocol error styles.
 * @param {object} opts.styles.icons Icons in URL link or `data:uri`.
 * @param {string} opts.styles.icons.synchronized Synchronized state.
 * @param {string} opts.styles.icons.disconnected Disconnected state.
 * @param {string} opts.styles.icons.wait Wait state.
 * @param {string} opts.styles.icons.sending Sending state.
 * @param {string} opts.styles.icons.error Error state.
 * @param {string} opts.styles.icons.protocolError Protocol error state.
 * @param {object} opts.messages Widget text for different states.
 * @param {object} opts.messages.synchronized Text for synchronized state.
 * @param {object} opts.messages.disconnected Text for disconnected state.
 * @param {object} opts.messages.wait Text for wait state.
 * @param {object} opts.messages.sending Text for sending state.
 * @param {object} opts.messages.syncError Logux error text.
 * @param {object} opts.messages.error Error text.
 * @param {object} opts.messages.denied Denied text.
 * @param {object} opts.messages.protocolError Protocol error text.
 * @param {string} [opts.position="bottom-right"] Widget position.
 * @param {number} [opts.duration=3000] Synchronized state duration.
 *
 * @return {Function} Unbind badge listener and remove widget from DOM.
 *
 * @example
 * import badge from '@logux/client/badge'
 * import styles from '@logux/client/badge/default'
 * import messages from '@logux/client/badge/en'
 *
 * badge(client, {
 *  messages: messages,
 *  styles: {
 *    ...styles,
 *    synchronized: { backgroundColor: 'green' }
 *  },
 *  position: 'top-left'
 * })
 *
 * @name badge
 * @function
 */
function badge (client, opts) {
  var messages = opts.messages
  var position = opts.position || 'bottom-right'
  var styles = opts.styles

  var widget = document.createElement('div')
  var text = document.createElement('span')

  widget.setAttribute('role', 'alert')

  injectStyles(widget, RESET)
  injectStyles(widget, styles.base)
  injectStyles(text, styles.text)
  setPosition(widget, position)

  function show (style, msg) {
    text.innerHTML = msg
    injectStyles(widget, style)
    widget.style.display = 'block'
  }

  function hide () {
    widget.style.display = 'none'
  }

  var unbind = status(client, function (state) {
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

  return function () {
    unbind()
    document.body.removeChild(widget)
  }
}

module.exports = badge
