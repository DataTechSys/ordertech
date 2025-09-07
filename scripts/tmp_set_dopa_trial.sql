-- Set DOPA subscription to trial for 14 days from now (UTC ISO string)
INSERT INTO tenant_settings (tenant_id, features)
VALUES (
  '21fb61e1-01df-40f2-af91-1b3684ea9e91',
  jsonb_build_object(
    'subscription', jsonb_build_object(
      'tier','trial',
      'trial_ends_at', to_char((now() + interval '14 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
)
ON CONFLICT (tenant_id) DO UPDATE
SET features = coalesce(tenant_settings.features, '{}'::jsonb)
  || jsonb_build_object(
       'subscription', jsonb_build_object(
         'tier','trial',
         'trial_ends_at', to_char((now() + interval '14 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
       )
     );

