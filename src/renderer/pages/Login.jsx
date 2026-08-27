import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getRendererErrorMessage, reportRendererError } from '../utils/rendererError.js';

import {
  AlertCircle,
  Clock3,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
} from 'lucide-react';

function Login({ onLoginSuccess, appVersion }) {
  const passwordInputRef = useRef(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] =
    useState('');
  const [rememberCredentials, setRememberCredentials] = useState(false);

  const [showPassword, setShowPassword] =
    useState(false);

  const [isLoading, setIsLoading] =
    useState(false);

  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    window.electronAPI?.getSavedCredentials?.()
      .then((result) => {
        const credentials = result?.data;
        if (!active || !credentials?.email || !credentials?.password) return;
        setEmail(credentials.email);
        setPassword(credentials.password);
        setRememberCredentials(true);
      })
      .catch((loadError) => {
        reportRendererError('No se pudieron cargar las credenciales recordadas', loadError);
      });
    return () => {
      active = false;
    };
  }, []);

  const normalizedEmail = useMemo(() => {
    return email.trim().toLowerCase();
  }, [email]);

  const canSubmit =
    normalizedEmail.length > 0 && password.length > 0 &&
    !isLoading;

  const handleEmailChange = (event) => {
    setEmail(event.target.value);

    if (error) {
      setError('');
    }
  };

  const handlePasswordChange = (event) => {
    setPassword(event.target.value);

    if (error) {
      setError('');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    if (!normalizedEmail) {
      setError(
        'Ingresa tu correo electrónico.',
      );

      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setError(
        'Ingresa un correo electrónico válido.',
      );

      return;
    }

    if (!password) {
      setError('Ingresa tu contraseña.');

      passwordInputRef.current?.focus();

      return;
    }

    if (
      !window.electronAPI ||
      typeof window.electronAPI.login !==
        'function'
    ) {
      setError(
        'No fue posible comunicarse con la aplicación de escritorio.',
      );

      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result =
          await window.electronAPI.login({
            email: normalizedEmail,
            password,
            rememberCredentials,
          });

      if (!result?.success) {
        setError(
          getRendererErrorMessage(
            { message: result?.message },
            'El correo o la contraseña no son correctos.',
          ),
        );

        return;
      }

      if (!result?.user) {
        setError(
          'La autenticación fue exitosa, pero no se recibió la información del usuario.',
        );

        return;
      }

      onLoginSuccess?.(result.user);
    } catch (loginError) {
      reportRendererError('Error iniciando sesión', loginError);

      setError(
        getRendererErrorMessage(
          loginError,
          'Error de conexión. Verifica que el backend esté disponible.',
        ),
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#292b26] p-4 sm:p-6">
      <div
        className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full bg-[#94602a]/15 blur-3xl"
        aria-hidden="true"
      />

      <div
        className="pointer-events-none absolute -bottom-40 -right-32 h-96 w-96 rounded-full bg-[#78866b]/15 blur-3xl"
        aria-hidden="true"
      />

      <section className="relative w-full max-w-[410px] overflow-hidden rounded-[24px] border border-[#45483f] bg-[#fbf9f4] shadow-[0_30px_90px_rgba(16,17,14,0.45)]">
        <header className="border-b border-[#e3ded4] bg-[#f4f0e8] px-6 py-5 sm:px-7">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[15px] border border-[#d8b98c] bg-[#ead7bb] text-[#76501f] shadow-[0_6px_16px_rgba(118,80,31,0.12)]">
              <Clock3
                className="h-6 w-6"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-[-0.04em] text-[#292b26]">
                LogYourTime
              </h1>

              <p className="mt-0.5 text-xs leading-5 text-[#777970]">
                Accede a tu espacio de trabajo.
              </p>
            </div>

            <span className="shrink-0 rounded-full border border-[#d8d2c7] bg-[#fffdf8] px-2 py-1 text-[9px] font-semibold tracking-wide text-[#777970]">
              v{appVersion}
            </span>
          </div>
        </header>

        <div className="px-6 py-5 sm:px-7 sm:py-6">
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-5 flex items-start gap-3 rounded-xl border border-[#ddb0a1] bg-[#f5e4df] px-4 py-3"
            >
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-[#a05243]"
                strokeWidth={1.8}
                aria-hidden="true"
              />

              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#873e33]">
                  No se pudo iniciar sesión
                </p>

                <p className="mt-1 text-xs leading-5 text-[#98483a]">
                  {error}
                </p>
              </div>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="space-y-3.5"
            noValidate
          >
            <FormField
              id="login-email"
              label="Correo electrónico"
              icon={Mail}
            >
              <input
                id="login-email"
                name="email"
                type="email"
                value={email}
                onChange={handleEmailChange}
                disabled={isLoading}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="tu@empresa.com"
                required
                className={inputClasses(true)}
              />
            </FormField>

            <FormField
              id="login-password"
              label="Contraseña"
              icon={Lock}
            >
              <input
                ref={passwordInputRef}
                id="login-password"
                name="password"
                type={
                  showPassword
                    ? 'text'
                    : 'password'
                }
                value={password}
                onChange={
                  handlePasswordChange
                }
                disabled={isLoading}
                autoComplete="current-password"
                placeholder="Ingresa tu contraseña"
                required
                className={`${inputClasses(
                  true,
                )} pr-11`}
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(
                    (currentValue) =>
                      !currentValue,
                  )
                }
                disabled={isLoading}
                aria-label={
                  showPassword
                    ? 'Ocultar contraseña'
                    : 'Mostrar contraseña'
                }
                title={
                  showPassword
                    ? 'Ocultar contraseña'
                    : 'Mostrar contraseña'
                }
                className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#85877f] transition-colors hover:bg-[#efebe3] hover:text-[#30332c] focus:outline-none focus:ring-2 focus:ring-[#94602a]/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {showPassword ? (
                  <EyeOff
                    className="h-4 w-4"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                ) : (
                  <Eye
                    className="h-4 w-4"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                )}
              </button>
            </FormField>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ded9cf] bg-[#f5f1e9] px-3.5 py-3 text-xs text-[#62655d] transition-colors hover:border-[#c9c1b5] hover:bg-[#f1ece3]">
              <input
                type="checkbox"
                checked={rememberCredentials}
                onChange={(event) => setRememberCredentials(event.target.checked)}
                disabled={isLoading}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#c9c2b7] accent-[#76501f]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-semibold text-[#4b4e46]">
                  Recordar credenciales
                  <ShieldCheck className="h-3.5 w-3.5 text-[#687461]" strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-[#898b83]">
                  Guardadas de forma cifrada en este equipo.
                </span>
              </span>
            </label>

            <button
              type="submit"
              disabled={!canSubmit}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2b2e27] px-4 text-xs font-semibold text-[#f7f3ea] transition-[background-color,box-shadow,transform] hover:bg-[#1f211c] hover:shadow-[0_8px_20px_rgba(43,46,39,0.18)] focus:outline-none focus:ring-4 focus:ring-[#2b2e27]/15 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {isLoading ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />

                  Iniciando sesión...
                </>
              ) : (
                <>
                  <LogIn
                    className="h-4 w-4"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />

                  Iniciar sesión
                </>
              )}
            </button>
          </form>

        </div>
        
      </section>
    </main>
  );
}

function FormField({
  id,
  label,
  icon: Icon,
  children,
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-semibold text-[#62655d]"
      >
        {label}
      </label>

      <div className="relative">
        {Icon && (
          <Icon
            className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[#8b8d85]"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        )}

        {children}
      </div>
    </div>
  );
}

function inputClasses(
  hasIcon = false,
) {
  return `
    h-11 w-full rounded-xl
    border border-[#d8d2c7]
    bg-[#fffdf8]
    ${hasIcon ? 'pl-9' : 'pl-3.5'}
    pr-3 text-sm font-medium text-[#4b4e46]
    outline-none
    transition-[border-color,box-shadow,background-color]
    placeholder:text-[#a0a199]
    hover:border-[#bdb5a9]
    focus:border-[#94602a]
    focus:bg-white
    focus:ring-4 focus:ring-[#a76b2d]/10
    disabled:cursor-not-allowed
    disabled:bg-[#eeeae2]
    disabled:text-[#92938c]
    disabled:opacity-70
  `;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    value,
  );
}

export default Login;
