insert into customers (id, name, email, city) values
    ('maya',  'Maya Singh',    'maya@example.com',  'Toronto, ON'),
    ('liam',  'Liam Tremblay', 'liam@example.com',  'Montréal, QC'),
    ('aisha', 'Aisha Khan',    'aisha@example.com', 'Vancouver, BC'),
    ('noah',  'Noah Chen',     'noah@example.com',  'Calgary, AB');

insert into accounts (id, customer_id, name, balance_cents) values
    ('maya-chq',  'maya',  'Everyday Chequing', 1245000),
    ('maya-sav',  'maya',  'High-Interest Savings', 3820000),
    ('liam-chq',  'liam',  'Everyday Chequing', 318025),
    ('aisha-chq', 'aisha', 'Everyday Chequing', 794010),
    ('noah-chq',  'noah',  'Everyday Chequing', 2160000);
