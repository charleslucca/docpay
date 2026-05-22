O erro `ERROR: unrecognized configuration parameter "transaction_timeout"` acontece porque o arquivo `backup_public.sql` foi gerado por uma versão mais nova do PostgreSQL/pg_dump e a VPS está com uma versão mais antiga que não reconhece essa configuração. Não é erro das tabelas do DocPay.

Plano para corrigir sem recriar tudo:

1. Adicionar ao guia uma etapa obrigatória entre exportar e importar: limpar o arquivo `.sql` removendo qualquer linha `SET transaction_timeout = 0;`.

2. Substituir o comando de importação por uma sequência segura:
   - fazer cópia de segurança do dump original;
   - remover `transaction_timeout`;
   - conferir se a linha sumiu;
   - só então enviar para a VPS e importar.

3. Incluir comandos separados para:

   Linux/Mac:
   ```bash
   cp backup_public.sql backup_public_original.sql
   sed -i.bak '/^SET transaction_timeout = /d' backup_public.sql
   grep -n "transaction_timeout" backup_public.sql || echo "OK: transaction_timeout removido"
   ```

   Windows PowerShell:
   ```powershell
   Copy-Item backup_public.sql backup_public_original.sql
   Get-Content backup_public.sql | Where-Object { $_ -notmatch '^SET transaction_timeout = ' } | Set-Content backup_public_limpo.sql
   Select-String -Path backup_public_limpo.sql -Pattern "transaction_timeout"
   ```

   No Windows, depois usar `backup_public_limpo.sql` no envio/importação.

4. Atualizar os comandos finais de importação para usar o dump limpo:
   ```bash
   scp backup_public.sql root@<IP_DA_VPS>:/opt/supabase/backup_public.sql
   ssh root@<IP_DA_VPS>
   docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction < /opt/supabase/backup_public.sql
   ```

5. Também adicionar uma observação importante: se aparecer esse erro em `backup_auth_users.sql`, aplicar a mesma limpeza nele antes de importar.