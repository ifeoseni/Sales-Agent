import { EventEmitter } from 'node:events';

/** Lightweight internal bus: 'lead' events let Telegram alert the team when a visitor leaves contact details. */
export const bus = new EventEmitter();
