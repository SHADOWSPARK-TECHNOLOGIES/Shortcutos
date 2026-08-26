export enum CapabilityAvailability {
  AVAILABLE = 'AVAILABLE',
  RESTRICTED = 'RESTRICTED',
  UNAVAILABLE = 'UNAVAILABLE',
  UNKNOWN = 'UNKNOWN',
  DEGRADED = 'DEGRADED'
}

export enum CapabilityBindingStatus {
  BOUND = 'BOUND',
  AMBIGUOUS = 'AMBIGUOUS',
  RESTRICTED = 'RESTRICTED',
  UNAVAILABLE = 'UNAVAILABLE',
  UNKNOWN = 'UNKNOWN'
}

export type CapabilityProviderRecord = {
  providerId: string;
  capability: string;
  availability: CapabilityAvailability;
};

export type CapabilityBindingResult = {
  capability: string;
  status: CapabilityBindingStatus;
  providerId: string | null;
  candidateProviderIds: string[];
};

export class CapabilityResolver {
  constructor(private readonly inventory: CapabilityProviderRecord[]) {}

  resolve(capability: string): CapabilityBindingResult {
    const matches = this.inventory.filter((item) => item.capability === capability);
    const available = matches
      .filter((item) => item.availability === CapabilityAvailability.AVAILABLE)
      .sort((a, b) => a.providerId.localeCompare(b.providerId));

    if (available.length === 1) {
      return {
        capability,
        status: CapabilityBindingStatus.BOUND,
        providerId: available[0]!.providerId,
        candidateProviderIds: [available[0]!.providerId]
      };
    }

    if (available.length > 1) {
      return {
        capability,
        status: CapabilityBindingStatus.AMBIGUOUS,
        providerId: null,
        candidateProviderIds: available.map((item) => item.providerId)
      };
    }

    const restricted = matches.filter((item) => item.availability === CapabilityAvailability.RESTRICTED);
    if (restricted.length > 0) {
      return {
        capability,
        status: CapabilityBindingStatus.RESTRICTED,
        providerId: null,
        candidateProviderIds: restricted.map((item) => item.providerId).sort()
      };
    }

    const unknown = matches.filter((item) => item.availability === CapabilityAvailability.UNKNOWN);
    if (unknown.length > 0) {
      return {
        capability,
        status: CapabilityBindingStatus.UNKNOWN,
        providerId: null,
        candidateProviderIds: unknown.map((item) => item.providerId).sort()
      };
    }

    return {
      capability,
      status: CapabilityBindingStatus.UNAVAILABLE,
      providerId: null,
      candidateProviderIds: matches.map((item) => item.providerId).sort()
    };
  }
}
