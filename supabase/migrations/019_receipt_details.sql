-- Receipt details read from the scan: the order number, and the card that paid (brand + last 4 digits ONLY).
alter table public.receipts add column if not exists order_number text;
alter table public.receipts add column if not exists card_brand text;
alter table public.receipts add column if not exists card_last4 text;
-- Never more than the last 4 digits of a card, whatever is sent.
alter table public.receipts drop constraint if exists receipts_card_last4_check;
alter table public.receipts add constraint receipts_card_last4_check check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');
