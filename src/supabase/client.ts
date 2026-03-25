export const supabase = new Proxy(
  {},
  {
    get() {
      throw new Error('O cliente Supabase do navegador foi desativado. Use as APIs autenticadas do backend.');
    }
  }
) as never;
