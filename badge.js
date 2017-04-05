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
 * @param {object} settings Configure widget appearance.
 * @param {object} settings.styles Configure widget styles for different states.
 * @param {object} settings.styles.baseStyles Configure widget container base
 *                                            styles.
 * @param {object} settings.styles.synchronized Styles in synchronized state.
 * @param {object} settings.styles.disconnected Styles in disconnected state.
 * @param {object} settings.styles.wait Styles in wait state.
 * @param {object} settings.styles.connecting Styles in connecting state.
 * @param {object} settings.styles.sending Styles in sending state.
 * @param {object} settings.styles.error Error styles.
 * @param {object} settings.styles.protocolError Protocol error styles.
 * @param {object} settings.messages Widget text for different states.
 * @param {object} settings.messages.synchronized Text in synchronized state.
 * @param {object} settings.messages.disconnected Text in disconnected state.
 * @param {object} settings.messages.wait Text in wait state.
 * @param {object} settings.messages.connecting Text in connecting state.
 * @param {object} settings.messages.sending Text in sending state.
 * @param {object} settings.messages.error Error text.
 * @param {object} settings.messages.protocolError Protocol error text.
 * @param {object} settings.icons Widget icons for different states.
 * @param {object} settings.icons.synchronized Icon in synchronized state.
 * @param {object} settings.icons.disconnected Icon in disconnected state.
 * @param {object} settings.icons.wait Icon in wait state.
 * @param {object} settings.icons.connecting Icon in connecting state.
 * @param {object} settings.icons.sending Icon in sending state.
 * @param {object} settings.icons.error Error icon.
 * @param {object} settings.icons.protocolError Protocol error icon.
 * @param {string} [settings.position] Widget position in browser.
 *
 * @return {Function} Unbind badge listener and remove widget from DOM.
 *
 * @example
 * import badge from 'logux-status/badge'
 * badge(client, {
 *  styles: {
 *    synchronized: { backgroundColor: 'green' }
 *  },
 *  position: 'top-left'
 * })
 */
function badge (client, settings) {
  var sync = client.sync

  var messages = settings.messages
  var icons = settings.icons
  var position = settings.position || 'bottom-right'

  var widget = document.createElement('div')
  var text = document.createElement('span')

  widget.id = 'logux-badge'

  function injectStateStyles (state) {
    injectStyles(widget, settings.styles[state])
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
  injectStyles(widget, settings.styles.baseStyles)

  // inject base text container styles
  injectStyles(text, {
    display: 'table-cell',
    verticalAlign: 'middle',
    height: settings.styles.baseStyles.height
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
