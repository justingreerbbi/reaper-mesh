import type { Message } from './messages.generated.ts';
export type Welcome = Extract<Message, { type: 'welcome' }>;
export type Capabilities = Readonly<{
  configSchema: number;
  features: number;
  maxPayload: number;
  receiptCapacity: number;
  ownerCapacity: number;
  ownerAdmitted: number;
  regions: number;
  maxLabelBytes: number;
  locationVersion?: number;
  screenVersion?: number;
  channelIdVersion?: number;
  discoveryVersion?: number;
  nodeCapacity?: number;
  firmware: string;
  radioVersion: number;
  messageVersion?: number;
  maxMessageBytes?: number;
  messageCapacity?: number;
  radioSchema?: number;
  maxChannels?: number;
  inboxVersion?: number;
  inboxCapacity?: number;
}>;

export function capabilities(message: Welcome): Capabilities | undefined {
  const {
    configSchema,
    features,
    maxPayload,
    receiptCapacity,
    ownerCapacity,
    ownerAdmitted,
    regions,
    maxLabelBytes,
    firmware,
    radioVersion,
  } = message;
  if (
    [
      configSchema,
      features,
      maxPayload,
      receiptCapacity,
      ownerCapacity,
      ownerAdmitted,
      regions,
      maxLabelBytes,
      firmware,
      radioVersion,
    ].some(value => value === undefined)
  )
    return undefined;
  return Object.freeze({
    configSchema,
    features,
    maxPayload,
    receiptCapacity,
    ownerCapacity,
    ownerAdmitted,
    regions,
    maxLabelBytes,
    firmware,
    radioVersion,
    ...(message.locationVersion !== undefined ? { locationVersion: message.locationVersion } : {}),
    ...(message.screenVersion !== undefined ? { screenVersion: message.screenVersion } : {}),
    ...(message.channelIdVersion !== undefined
      ? { channelIdVersion: message.channelIdVersion }
      : {}),
    ...(message.discoveryVersion !== undefined
      ? { discoveryVersion: message.discoveryVersion, nodeCapacity: message.nodeCapacity }
      : {}),
    ...(message.inboxVersion !== undefined ? { inboxVersion: message.inboxVersion } : {}),
    ...(message.inboxCapacity !== undefined ? { inboxCapacity: message.inboxCapacity } : {}),
    ...(message.radioSchema !== undefined ? { radioSchema: message.radioSchema } : {}),
    ...(message.maxChannels !== undefined ? { maxChannels: message.maxChannels } : {}),
    ...(message.messageVersion !== undefined ? { messageVersion: message.messageVersion } : {}),
    ...(message.maxMessageBytes !== undefined ? { maxMessageBytes: message.maxMessageBytes } : {}),
    ...(message.messageCapacity !== undefined ? { messageCapacity: message.messageCapacity } : {}),
  }) as Capabilities;
}

export function writeBlockReason(value: Capabilities | undefined): string | undefined {
  if (!value) return 'device capability metadata is incomplete';
  if (value.configSchema !== 1) return 'unsupported configuration schema';
  if ((value.features & 7) !== 7) return 'device lacks safe configuration/recovery features';
  if (
    value.maxPayload < 512 ||
    value.receiptCapacity < 1 ||
    value.ownerCapacity < 1 ||
    value.maxLabelBytes < 1 ||
    value.maxLabelBytes > 64 ||
    !(value.regions & 7)
  ) {
    return 'device resource limits are unsupported';
  }
  if (value.ownerAdmitted !== 1) return 'device owner capacity exhausted; new writes are disabled';
  return undefined;
}
