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
        element.style.top = '20px'
        break
      case 'middle':
        element.style.top = '50%'
        element.style.transform = 'translateY(-50%)'
        break
      case 'bottom':
        element.style.bottom = '20px'
        break
      case 'left':
        element.style.left = '20px'
        break
      case 'center':
        element.style.left = '50%'
        element.style.transform = 'translateX(-50%)'
        break
      case 'right':
        element.style.right = '20px'
        break
    }
  })
  if (position === 'middle-center' || position === 'center-middle') {
    element.style.top = '50%'
    element.style.left = '50%'
    element.style.transform = 'translate(-50%, -50%)'
  }
}

/**
 * Display Logux widget in browser.
 *
 * @param {Syncable|Client} client Observed Client instance
 *                                 or object with `sync` property.
 * @param {object} options Widget settings.
 * @param {object} options.styles Inline styles for different states.
 * @param {object} options.styles.baseStyles Configure widget container base
 *                                           styles.
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
 * @param {string} options.styles.icons.connecting Connecting state.
 * @param {string} options.styles.icons.sending Sending state.
 * @param {string} options.styles.icons.error Error state.
 * @param {string} options.styles.icons.protocolError Protocol error state.
 * @param {object} options.messages Widget text for different states.
 * @param {object} options.messages.synchronized Text for synchronized state.
 * @param {object} options.messages.disconnected Text for disconnected state.
 * @param {object} options.messages.wait Text for wait state.
 * @param {object} options.messages.connecting Text for connecting state.
 * @param {object} options.messages.sending Text for sending state.
 * @param {object} options.messages.error Error text.
 * @param {object} options.messages.protocolError Protocol error text.
 * @param {string} [options.position="bottom-right"] Widget position.
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
  var sync = client.sync

  var messages = options.messages
  var icons = options.styles.icons
  var position = options.position || 'bottom-right'

  var widget = document.createElement('div')
  var text = document.createElement('span')

  widget.id = 'logux-badge'

  function injectStateStyles (state) {
    injectStyles(widget, options.styles[state])
  }

  function injectIcon (state) {
    widget.style.backgroundImage = 'url(' + icons[state] + ')'
    widget.style.backgroundPosition = '15px center'
    widget.style.backgroundRepeat = 'no-repeat'
  }

  // reset inherited CSS properties
  injectStyles(widget, {
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
  })

  // inject base widget styles
  injectStyles(widget, options.styles.baseStyles)

  // inject base text container styles
  injectStyles(text, {
    display: 'table-cell',
    verticalAlign: 'middle',
    height: options.styles.baseStyles.height
  })

  setPosition(widget, position)

  var unbind = []

  var isWaiting = false
  var isConnecting = false

  unbind.push(sync.on('state', function () {
    injectIcon(sync.state)
    injectStateStyles(sync.state)

    switch (sync.state) {
      case 'synchronized': {
        if (isConnecting) {
          show(widget)
          text.innerHTML = messages.synchronized

          isWaiting = false
          isConnecting = false

          setTimeout(function () {
            hide(widget)
          }, 3000)
        } else {
          hide(widget)
        }
        break
      }
      case 'disconnected': {
        show(widget)
        text.innerHTML = messages.disconnected

        isWaiting = false
        isConnecting = false
        break
      }
      case 'wait': {
        show(widget)
        text.innerHTML = messages.wait

        isConnecting = false
        isWaiting = true
        break
      }
      case 'connecting': {
        hide(widget)
        if (isWaiting) {
          show(widget)
          text.innerHTML = messages.connecting

          isConnecting = true
          isWaiting = false
        }
        break
      }
      case 'sending': {
        hide(widget)
        if (isWaiting) {
          show(widget)
          text.innerHTML = messages.sending

          isConnecting = true
          isWaiting = false
        }
        break
      }
    }
  }))

  unbind.push(sync.on('error', function (error) {
    show(widget)
    if (error.type === 'wrong-protocol' || error.type === 'wrong-subprotocol') {
      text.innerHTML = messages.protocolError

      injectIcon('protocolError')
      injectStateStyles('protocolError')
    } else {
      text.innerHTML = messages.error

      injectIcon('error')
      injectStateStyles('error')
    }
  }))

  unbind.push(sync.on('clientError', function () {
    show(widget)
    text.innerHTML = messages.error

    injectIcon('error')
    injectStateStyles('error')
  }))

  widget.appendChild(text)
  document.body.appendChild(widget)

  return function () {
    for (var i = 0; i < unbind.length; i++) {
      unbind[i]()
    }
    document.body.removeChild(widget)
  }
}

module.exports = badge
