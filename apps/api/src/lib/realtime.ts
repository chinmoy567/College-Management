/** Late-bound bridge so services can emit socket events without importing the socket server (and tests can swap it). */
export interface Emitter {
  toUser(userId: string, event: string, payload: unknown): void;
  /** Everyone in `conv:<id>` except sockets of `exceptUserIds` (users who blocked the sender). */
  toConversation(conversationId: string, event: string, payload: unknown, exceptUserIds?: string[]): void;
  isOnline(userId: string): boolean;
}
let emitter: Emitter = { toUser() {}, toConversation() {}, isOnline: () => false };
export const setEmitter = (e: Emitter): void => {
  emitter = e;
};
export const realtime = (): Emitter => emitter;
