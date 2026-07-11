import { useEffect, useState } from 'react';

import { apiClient } from '../../lib/api';

export function useMediaSource(source: string): string {
  const [resolved, setResolved] = useState(source);
  useEffect(() => {
    if (!source.startsWith('/api/media/')) {
      setResolved(source);
      return;
    }
    let active = true;
    let objectUrl = '';
    apiClient.mediaObjectUrl(source).then((url) => {
      objectUrl = url;
      if (active) setResolved(url);
      else URL.revokeObjectURL(url);
    }).catch(() => { if (active) setResolved(''); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);
  return resolved;
}
