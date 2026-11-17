export interface BookCardRow {
  id: string; title: string; author: string; publisher: string | null; price: number; course: string | null; courseId: string | null;
  groupType: string | null; classLevel: string | null; coverUrl: string | null; unlocked: boolean; hasPdf: boolean;
}
export interface BookDetails extends BookCardRow { description: string | null; previewUrl: string | null }
export interface MyBookRow extends BookCardRow { purchasedAt: string; paidPrice: number; archived: boolean }
export interface AdminBookRow extends BookCardRow { previewPages: number[]; purchases: number; status: 'processing' | 'published' | 'archived' }

export const GROUPS: [string, string][] = [['science', 'Science'], ['commerce', 'Commerce'], ['arts', 'Arts'], ['common', 'Common']];
export const taka = (n: number): string => (n === 0 ? 'Free' : `৳${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

export interface AiConversation { id: string; title: string; updatedAt: string }
export interface AiMessage { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }
