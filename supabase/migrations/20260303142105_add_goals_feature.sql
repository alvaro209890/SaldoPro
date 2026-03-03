-- Financial Profiles (one row per user)
CREATE TABLE IF NOT EXISTS app_financial_profiles (
    uid TEXT PRIMARY KEY,
    monthly_income NUMERIC NOT NULL DEFAULT 0,
    fixed_expenses NUMERIC NOT NULL DEFAULT 0,
    variable_expenses NUMERIC NOT NULL DEFAULT 0,
    savings_target_pct NUMERIC NOT NULL DEFAULT 10,
    financial_goals_text TEXT,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_financial_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own profile" ON app_financial_profiles
    FOR ALL USING (true) WITH CHECK (true);

-- Goals
CREATE TABLE IF NOT EXISTS app_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uid TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    target_amount NUMERIC,
    current_amount NUMERIC NOT NULL DEFAULT 0,
    deadline DATE,
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'active',
    priority TEXT NOT NULL DEFAULT 'medium',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_goals_uid ON app_goals(uid);

ALTER TABLE app_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own goals" ON app_goals
    FOR ALL USING (true) WITH CHECK (true);
