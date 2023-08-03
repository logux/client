import type { Client } from '../client/index.js'

export interface BadgeMessages {
  denied: string
  disconnected: string
  error: string
  protocolError: string
  sending: string
  syncError: string
  synchronized: string
  wait: string
}

export interface BadgeStyles {
  base: object
  connecting: object
  disconnected: object
  error: object
  icon: {
    disconnected: string
    error: string
    protocolError: string
    sending: string
    synchronized: string
    wait: string
  }
  protocolError: object
  sending: object
  synchronized: object
  text: object
  wait: object
}

interface BadgeOptions {
  /**
   * Synchronized state duration. Default is `3000`.
   */
  duration?: number

  /**
   * Widget text for different states.
   */
  messages: BadgeMessages

  /**
   * Widget position. Default is `bottom-right`.
   */
  position?:
    | 'bottom-center'
    | 'bottom-left'
    | 'bottom-right'
    | 'middle-center'
    | 'middle-left'
    | 'middle-right'
    | 'top-center'
    | 'top-left'
    | 'top-right'

  /**
   * Inline styles for different states.
   */
  styles: BadgeStyles
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
