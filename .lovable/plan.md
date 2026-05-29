Trocar a URL do Supabase no `src/integrations/supabase/client.ts` de `http://191.101.234.62:8000` para `https://191.101.234.62:8443`, mantendo a mesma ANON_KEY da VPS.

Isso resolve o bloqueio de mixed content no preview/published do Lovable (HTTPS → HTTPS) e mantém o login funcionando local também.

**Pré-requisito (infra, fora do código):** a VPS precisa estar realmente escutando HTTPS na 8443 com certificado válido (Caddy/Nginx + Let's Encrypt, ou outro proxy TLS). Se o certificado for self-signed, o browser bloqueia igual.

**Teste após aplicar:** abrir o preview, tentar logar com um dos 3 emails confirmados na VPS, verificar no DevTools → Network que a chamada vai para `https://191.101.234.62:8443/auth/v1/token`.