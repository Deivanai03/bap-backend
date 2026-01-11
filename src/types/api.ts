export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  meta?: {
    request_id: string;
    timestamp: string;
    total?: number;
    page?: number;
    per_page?: number;
  };
  errors?: string[];
}

export interface AuthResponse {
  session_token: string;
  refresh_token: string;
  jwt_token: string;
  expires_at: string;
  user: {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    org_id: string;
  };
}