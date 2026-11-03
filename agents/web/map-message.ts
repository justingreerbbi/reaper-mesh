import type { MapOperation } from '../../packages/protocol/map-item.ts';
import type { SharedRecord } from './map-store.ts';
/** Approval UI is derived from map storage, never from chat retention or delivery ACKs. */
export function mapMessageAction(op: MapOperation, record?: SharedRecord, acceptedRevision?: number) {
  if (record && record.highest > op.item.revision) return { label: 'Newer revision received', actionable: false };
  if (record && !record.pending) {
    if (acceptedRevision === op.item.revision) return { label: 'Added to map', actionable: false };
    return { label: op.operation === 'withdraw' ? 'Not on map' : 'Not added to map', actionable: false };
  }
  return { label: op.operation === 'withdraw' ? 'Remove from map' : record?.accepted ? 'Update on map' : 'Add to map', actionable: true };
}
