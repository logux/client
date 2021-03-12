import { Client } from '../client/index.js'

export type BadgeMessages = {
  synchronized: string
  disconnected: string
  wait: string
  sending: string
  syncError: string
  error: string
  denied: string
  protocolError: string
}

export type BadgeStyles = {
  base: object
  text: object
  synchronized: object
  disconnected: object
  wait: object
  connecting: object
  sending: object
  error: object
  protocolError: object
  icon: {
    synchronized: string
    disconnected: string
    wait: string
    sending: string
    error: string
    protocolError: string
  }
}

type BadgeOptions = {
  /**
   * Widget text for different states.
   */
  messages: BadgeMessages

  /**
   * Inline styles for different states.
   */
  styles: BadgeStyles

  /**
   * Widget position. Default is `bottom-right`.
   */
  position?:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'middle-left'
    | 'middle-center'
    | 'middle-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'

  /**
   * Synchronized state duration. Default is `3000`.
   */
  duration?: number
}

/**
 * Display Logux widget in browser.
 *
 * ```js
 * import { badge, badgeEn } from '@logux/client'
 * import { badgeStyles } from '@logux/client/badge/styles'
 *
 * badge(client, {
 *  messages: badgeEn,
 *  styles: {
 *    ...badgeStyles,
 *    synchronized: { backgroundColor: 'green' }
 *  },
 *  position: 'top-left'
 * })
 * ```
 *
 * @param client Observed Client instance.
 * @param opts Widget settings.
 * @returns Unbind badge listener and remove widget from DOM.
 */
export function badge(client: Client, opts: BadgeOptions): () => void

/**
 * Russian translation for widget.
 */
export const badgeRu: BadgeMessages

/**
 * English translation for widget.
 */
export const badgeEn: BadgeMessages
