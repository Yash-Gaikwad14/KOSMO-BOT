/**
 * UnbelievaBoat External Economy Client
 *
 * Scope: Handles communication with the UnbelievaBoat REST API for Sparks mutation.
 * UnbelievaBoat is the sole authority for the Sparks economy balance.
 * KOSMO-BOT maintains no internal balance or secondary ledger.
 */

export interface UnbelievaBoatResponse {
  success: boolean;
  status?: number;
  error?: string;
  data?: any;
}

export interface IUnbelievaBoatClient {
  grantSparks(
    guildId: string,
    userId: string,
    amount: number,
    reason: string
  ): Promise<UnbelievaBoatResponse>;
  getUserBalance(
    guildId: string,
    userId: string
  ): Promise<UnbelievaBoatResponse>;
  getGuildLeaderboard(
    guildId: string,
    sort?: 'total' | 'cash' | 'bank',
    limit?: number,
    page?: number
  ): Promise<UnbelievaBoatResponse>;
}

export class UnbelievaBoatClient implements IUnbelievaBoatClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    fetchFn?: typeof fetch;
  }) {
    this.apiKey = options?.apiKey ?? (process.env.UNBELIEVABOAT_API_KEY || '');
    this.baseUrl = options?.baseUrl ?? 'https://unbelievaboat.com/api/v1';
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  /**
   * Grants Sparks (cash) to a user in the specified guild via UnbelievaBoat API.
   *
   * @param guildId Discord Guild ID
   * @param userId Discord User ID
   * @param amount Positive integer of Sparks to grant
   * @param reason Audit reason for the balance update
   */
  async grantSparks(
    guildId: string,
    userId: string,
    amount: number,
    reason: string
  ): Promise<UnbelievaBoatResponse> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'UnbelievaBoat API key is not configured.',
      };
    }

    if (!guildId || !userId) {
      return {
        success: false,
        error: 'Guild ID and User ID are required.',
      };
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      return {
        success: false,
        error: 'Amount must be a positive integer.',
      };
    }

    const endpoint = `${this.baseUrl}/guilds/${encodeURIComponent(guildId)}/users/${encodeURIComponent(userId)}`;

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'PATCH',
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          cash: amount,
          reason,
        }),
      });

      if (response.ok) {
        let data: any = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }

        return {
          success: true,
          status: response.status,
          data,
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          status: 429,
          error: 'Rate limit exceeded with economy service. Please try again in a few moments.',
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          status: response.status,
          error: 'Economy service authorization failed.',
        };
      }

      if (response.status === 400 || response.status === 404) {
        return {
          success: false,
          status: response.status,
          error: 'Target user or guild not found on economy service.',
        };
      }

      if (response.status >= 500) {
        return {
          success: false,
          status: response.status,
          error: `Economy service encountered a server error (HTTP ${response.status}).`,
        };
      }

      return {
        success: false,
        status: response.status,
        error: `Economy service returned unexpected status HTTP ${response.status}.`,
      };
    } catch (networkErr: any) {
      return {
        success: false,
        error: `Failed to connect to economy service: ${networkErr?.message || 'Network error'}`,
      };
    }
  }

  /**
   * Retrieves the Sparks balance for a user in the specified guild via UnbelievaBoat API.
   * Read-only: never mutates user balance.
   *
   * @param guildId Discord Guild ID
   * @param userId Discord User ID
   */
  async getUserBalance(
    guildId: string,
    userId: string
  ): Promise<UnbelievaBoatResponse> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'UnbelievaBoat API key is not configured.',
      };
    }

    if (!guildId || !userId) {
      return {
        success: false,
        error: 'Guild ID and User ID are required.',
      };
    }

    const endpoint = `${this.baseUrl}/guilds/${encodeURIComponent(guildId)}/users/${encodeURIComponent(userId)}`;

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'GET',
        headers: {
          Authorization: this.apiKey,
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        let data: any = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }

        return {
          success: true,
          status: response.status,
          data,
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          status: 429,
          error: 'Rate limit exceeded with economy service. Please try again in a few moments.',
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          status: response.status,
          error: 'Economy service authorization failed.',
        };
      }

      if (response.status === 404) {
        return {
          success: false,
          status: 404,
          error: 'Target user or guild not found on economy service.',
        };
      }

      if (response.status >= 500) {
        return {
          success: false,
          status: response.status,
          error: `Economy service encountered a server error (HTTP ${response.status}).`,
        };
      }

      return {
        success: false,
        status: response.status,
        error: `Economy service returned unexpected status HTTP ${response.status}.`,
      };
    } catch (networkErr: any) {
      return {
        success: false,
        error: `Failed to connect to economy service: ${networkErr?.message || 'Network error'}`,
      };
    }
  }

  /**
   * Retrieves the leaderboard for a guild via UnbelievaBoat API.
   * Read-only: never mutates user balances.
   *
   * @param guildId Discord Guild ID
   * @param sort Sort key: 'total' | 'cash' | 'bank' (default: 'total')
   * @param limit Number of entries per page (default: 10)
   * @param page Page number (default: 1)
   */
  async getGuildLeaderboard(
    guildId: string,
    sort: 'total' | 'cash' | 'bank' = 'total',
    limit = 10,
    page = 1
  ): Promise<UnbelievaBoatResponse> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'UnbelievaBoat API key is not configured.',
      };
    }

    if (!guildId) {
      return {
        success: false,
        error: 'Guild ID is required.',
      };
    }

    const queryParams = new URLSearchParams({
      sort,
      limit: String(limit),
      page: String(page),
    });

    const endpoint = `${this.baseUrl}/guilds/${encodeURIComponent(guildId)}/leaderboard?${queryParams.toString()}`;

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'GET',
        headers: {
          Authorization: this.apiKey,
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        let data: any = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }

        return {
          success: true,
          status: response.status,
          data,
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          status: 429,
          error: 'Rate limit exceeded with economy service. Please try again in a few moments.',
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          status: response.status,
          error: 'Economy service authorization failed.',
        };
      }

      if (response.status === 404) {
        return {
          success: false,
          status: 404,
          error: 'Target guild not found on economy service.',
        };
      }

      if (response.status >= 500) {
        return {
          success: false,
          status: response.status,
          error: `Economy service encountered a server error (HTTP ${response.status}).`,
        };
      }

      return {
        success: false,
        status: response.status,
        error: `Economy service returned unexpected status HTTP ${response.status}.`,
      };
    } catch (networkErr: any) {
      return {
        success: false,
        error: `Failed to connect to economy service: ${networkErr?.message || 'Network error'}`,
      };
    }
  }
}

export const defaultUnbelievaBoatClient = new UnbelievaBoatClient();
