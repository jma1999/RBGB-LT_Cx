export {};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: GoogleOAuthError) => void;
          }): GoogleTokenClient;
          hasGrantedAllScopes(
            tokenResponse: GoogleTokenResponse,
            firstScope: string,
            ...restScopes: string[]
          ): boolean;
          revoke(
            token: string,
            callback: (response: { successful: boolean }) => void,
          ): void;
        };
      };
    };
  }

  interface GoogleTokenClient {
    callback: (response: GoogleTokenResponse) => void;
    requestAccessToken(options?: {
      prompt?: "" | "consent" | "select_account";
    }): void;
  }

  interface GoogleTokenResponse {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  }

  interface GoogleOAuthError {
    type?: string;
    message?: string;
  }
}
