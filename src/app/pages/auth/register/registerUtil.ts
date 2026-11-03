import type {
  IAuthData,
  MatrixClient,
  MatrixError,
  RegisterRequest,
  RegisterResponse,
} from 'matrix-js-sdk';
import { CompletedAuth, useCompleteSession } from '../completeSession';
















  | { kind: 'success'; response: RegisterResponse }
  | { kind: 'uia'; authData: IAuthData }
  | { kind: 'error'; error: RegisterError; message?: string };

const REGISTER_ERRORS: Record<string, RegisterError> = {
  M_USER_IN_USE: RegisterError.UserTaken,
  M_INVALID_USERNAME: RegisterError.UserInvalid,
  M_EXCLUSIVE: RegisterError.UserExclusive,
  M_WEAK_PASSWORD: RegisterError.PasswordWeak,
  M_PASSWORD_TOO_SHORT: RegisterError.PasswordShort,
  M_FORBIDDEN: RegisterError.Forbidden,
  M_LIMIT_EXCEEDED: RegisterError.RateLimited,
  M_BAD_JSON: RegisterError.InvalidRequest,
  M_NOT_JSON: RegisterError.InvalidRequest,
};

const isUiaResponse = (error: Partial<MatrixError>): boolean =>
  error.httpStatus === 401 &&
  typeof error.data === 'object' &&
  error.data !== null &&
  Array.isArray((error.data as IAuthData).flows);

/**
 * Sends one registration request. A 401 with flows means the server wants
 * another user-interactive auth stage; the caller answers with `data.auth`.
 * Every request asks for a refresh token.
 */
export const register = async (
  mx: MatrixClient,
  data: RegisterRequest
): Promise<RegisterResult> => {
  try {
    const response = await mx.registerRequest({ ...data, refresh_token: true });
    return { kind: 'success', response };
  } catch (error) {
    const matrixError = (error ?? {}) as Partial<MatrixError>;
    if (isUiaResponse(matrixError)) {
      return { kind: 'uia', authData: matrixError.data as IAuthData };
    }
    return {
      kind: 'error',
      error: REGISTER_ERRORS[matrixError.errcode ?? ''] ?? RegisterError.Unknown,
      message: matrixError.message,
    };
  }
};

/** Finishes a registration: stores the session and leaves the register page. */
export const useRegisterComplete = (data?: CustomRegisterResponse): boolean =>
  useCompleteSession(data);
