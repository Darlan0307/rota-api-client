import { useEffect, useState } from 'react';
import { APP_NAME } from '../../../shared/constants';
import type { AppInfo } from '../../../shared/ipc';
import { api } from './api';

let request: Promise<AppInfo> | undefined;

export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    request ??= api.invoke('app:getInfo');
    let alive = true;
    request.then(
      (value) => alive && setInfo(value),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

/** O mesmo User-Agent que o processo principal manda (ver RequestService). */
export function useUserAgent(): string | undefined {
  const info = useAppInfo();
  return info ? `${APP_NAME}/${info.version}` : undefined;
}
