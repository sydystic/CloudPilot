-- ====================================================================
-- CloudPilot Initial Database Schema Migration
-- Migration File: supabase/migrations/001_initial_schema.sql
-- Portable schema derived directly from CloudPilot backend and frontend code.
-- ====================================================================

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ====================================================================
-- 1. PUBLIC PROFILES TABLE (Linked to auth.users)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  onboarding_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Trigger to automatically create or update profile on auth.users changes
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    NEW.email,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ====================================================================
-- 2. USER WORKFLOWS TABLE
-- Tracks user-owned n8n workflow references and settings.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.user_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  engine_workflow_ref TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT user_workflows_user_engine_unique UNIQUE (user_id, engine_workflow_ref)
);

CREATE INDEX IF NOT EXISTS idx_user_workflows_user_id ON public.user_workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_user_workflows_engine_ref ON public.user_workflows(engine_workflow_ref);

ALTER TABLE public.user_workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select their own workflows"
  ON public.user_workflows FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own workflows"
  ON public.user_workflows FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workflows"
  ON public.user_workflows FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own workflows"
  ON public.user_workflows FOR DELETE
  USING (auth.uid() = user_id);


-- ====================================================================
-- 3. EXECUTIONS TABLE
-- Stores workflow run execution logs and timeline history.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_workflow_id UUID REFERENCES public.user_workflows(id) ON DELETE CASCADE,
  engine_workflow_ref TEXT NOT NULL,
  engine_execution_ref TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL, -- 'running', 'success', 'error'
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms BIGINT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_executions_user_id ON public.executions(user_id);
CREATE INDEX IF NOT EXISTS idx_executions_user_workflow_id ON public.executions(user_workflow_id);
CREATE INDEX IF NOT EXISTS idx_executions_engine_exec_ref ON public.executions(engine_execution_ref);
CREATE INDEX IF NOT EXISTS idx_executions_started_at ON public.executions(started_at DESC);

ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select their own executions"
  ON public.executions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own executions"
  ON public.executions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own executions"
  ON public.executions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own executions"
  ON public.executions FOR DELETE
  USING (auth.uid() = user_id);


-- ====================================================================
-- 4. USER CREDENTIALS TABLE (Encrypted Vault)
-- Encrypted credentials stored as AES-256-GCM payloads.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.user_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL,
  credential_name TEXT NOT NULL,
  encrypted_data TEXT NOT NULL, -- JSON string: { encrypted, iv, authTag }
  n8n_credential_id TEXT,
  is_valid BOOLEAN NOT NULL DEFAULT TRUE,
  last_validated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON public.user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON public.user_credentials(credential_type);

ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select their own credentials"
  ON public.user_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own credentials"
  ON public.user_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own credentials"
  ON public.user_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own credentials"
  ON public.user_credentials FOR DELETE
  USING (auth.uid() = user_id);


-- ====================================================================
-- 5. WORKFLOW TEMPLATES TABLE
-- Template marketplace catalog (publicly readable).
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  icon TEXT DEFAULT 'fa-bolt',
  template_json JSONB NOT NULL,
  required_credentials JSONB DEFAULT '[]'::jsonb,
  config_fields JSONB DEFAULT '[]'::jsonb,
  tags TEXT[] DEFAULT '{}'::text[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_template_id ON public.workflow_templates(template_id);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_category ON public.workflow_templates(category);

ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;

-- Templates are publicly readable by any authenticated or anonymous user
CREATE POLICY "Public read access for active workflow templates"
  ON public.workflow_templates FOR SELECT
  USING (is_active = TRUE);


-- ====================================================================
-- 6. AUDIT LOGS TABLE
-- Security audit events.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own audit logs"
  ON public.audit_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own audit logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- ====================================================================
-- 7. CONVERSATIONS & MESSAGES TABLES (Future Extensibility & Chat)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select their own conversations"
  ON public.conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversations"
  ON public.conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversations"
  ON public.conversations FOR DELETE
  USING (auth.uid() = user_id);


CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender TEXT NOT NULL, -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON public.messages(user_id);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select their own messages"
  ON public.messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own messages"
  ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- ====================================================================
-- 8. STORAGE BUCKETS SETUP
-- Ensure workflow_templates storage bucket exists and has read policy
-- ====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('workflow_templates', 'workflow_templates', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('workflows_templates', 'workflows_templates', true)
ON CONFLICT (id) DO NOTHING;

-- Public storage read policy
CREATE POLICY "Public read access for workflow template storage"
  ON storage.objects FOR SELECT
  USING (bucket_id IN ('workflow_templates', 'workflows_templates'));

-- ====================================================================
-- End of Migration
-- ====================================================================
