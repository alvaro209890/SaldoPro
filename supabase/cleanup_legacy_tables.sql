-- SaldoPro — Limpeza de tabelas legadas (desnecessarias)
-- Execute este script no SQL Editor do Supabase para remover
-- todas as tabelas que NÃO pertencem ao aplicativo atual.
--
-- Tabelas removidas: sistema de delivery/restaurante/inventario/cardapio
-- (restos de um projeto anterior que compartilhava o mesmo Supabase).
--
-- IMPORTANTE: Este script NAO apaga nenhum dado do SaldoPro.
-- As tabelas do app (app_*, whatsapp_*) permanecem intactas.

begin;

-- ── Delivery / Courier ──────────────────────────────────────────────
drop table if exists public.courier_devices cascade;
drop table if exists public.courier_location_updates cascade;
drop table if exists public.courier_profiles cascade;
drop table if exists public.courier_restaurant_memberships cascade;
drop table if exists public.courier_work_sessions cascade;
drop table if exists public.customer_addresses cascade;
drop table if exists public.customers cascade;
drop table if exists public.delivery_fee_rules cascade;
drop table if exists public.delivery_jobs cascade;

-- ── Financeiro legado (sistema antigo) ──────────────────────────────
drop table if exists public.financial_order_snapshots cascade;
drop table if exists public.financial_settings cascade;
drop table if exists public.financial_transactions cascade;

-- ── Inventario ──────────────────────────────────────────────────────
drop table if exists public.inventory_items cascade;
drop table if exists public.inventory_movements cascade;
drop table if exists public.inventory_order_deductions cascade;
drop table if exists public.inventory_product_recipes cascade;
drop table if exists public.inventory_products cascade;

-- ── Cardapio / Menu ─────────────────────────────────────────────────
drop table if exists public.menu_categories cascade;
drop table if exists public.menu_product_settings cascade;
drop table if exists public.menu_service_windows cascade;

-- ── Pedidos / Orders ────────────────────────────────────────────────
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;

-- ── Restaurante ─────────────────────────────────────────────────────
drop table if exists public.restaurant_pairing_codes cascade;
drop table if exists public.suppliers cascade;

-- ── Perfis de usuario legado ────────────────────────────────────────
drop table if exists public.user_profiles cascade;

commit;
