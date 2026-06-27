alter policy "Admins can see all notifications" 
on "public"."admin_notifications"
to authenticated
using (
  (EXISTS (
    SELECT 1 
    FROM users 
    WHERE (users.user_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), '0'::text))::bigint) 
    AND (users.role = 'admin'::text))
  ))
);

alter policy "Admins manage redemptions" 
on "public"."balance_redemptions"
to public
using (
  true
);

alter policy "Users can create redemptions" 
on "public"."balance_redemptions"
to public
with check (
  (user_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), '0'::text))::bigint))
);

alter policy "Users see own redemptions" 
on "public"."balance_redemptions"
to public
using (
  (user_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), '0'::text))::bigint))
);

alter policy "Allow public insert fbs_blocks" 
on "public"."fbs_blocks"
to public
with check (
  true
);

alter policy "Allow public read fbs_blocks" 
on "public"."fbs_blocks"
to public
using (
  true
);

alter policy "Allow public update fbs_blocks" 
on "public"."fbs_blocks"
to public
using (
  true
);

alter policy "Админы могут редактировать" 
on "public"."mixers"
to public
using (
  true
);

alter policy "Все могут читать миксеры" 
on "public"."mixers"
to public
using (
  true
);

alter policy "Admins full access orders" 
on "public"."orders"
to public
using (
  (EXISTS (
    SELECT 1 
    FROM users 
    WHERE (users.user_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), '0'::text))::bigint) 
    AND (users.role = 'admin'::text))
  ))
);

alter policy "Allow delete for admins and managers" 
on "public"."orders"
to authenticated
using (
  (EXISTS (
    SELECT 1 
    FROM users 
    WHERE (users.user_id = (current_setting('app.current_user_id'::text))::bigint) 
    AND (users.role = ANY (ARRAY['admin'::text, 'manager'::text]))
  ))
);

alter policy "Clients view own orders" 
on "public"."orders"
to public
using (
  (user_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), '0'::text))::bigint))
);

alter policy "Public can create orders" 
on "public"."orders"
to public
with check (
  true
);

alter policy "Staff can update orders" 
on "public"."orders"
to authenticated
using (
  (EXISTS (
    SELECT 1 
    (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.user_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), ''::text), '0'::text))::bigint) AND (users.role = ANY (ARRAY['admin'::text, 'manager'::text, 'dispatcher'::text, 'operator'::text])))))
);

alter policy "Staff view all orders" 
on "public"."orders"
to authenticated
using (
  (EXISTS (
    SELECT 1 
       FROM users
  WHERE ((users.user_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), ''::text), '0'::text))::bigint) AND (users.role = ANY (ARRAY['admin'::text, 'manager'::text, 'dispatcher'::text, 'operator'::text])))))
);

alter policy "Staff only access to recipes" 
on "public"."recipes"
to authenticated
using (
  (current_setting('app.current_user_role'::text, true) = ANY (ARRAY['admin'::text, 'manager'::text, 'dispatcher'::text, 'operator'::text]))
);

alter policy "Deny access for non-authenticated" 
on "public"."recipes"
to anon
using (
  false
);

alter policy "Staff can view all referral transactions" 
on "public"."referral_transactions"
to authenticated
using (
  (EXISTS (
    SELECT 1 
    FROM users 
    WHERE (users.user_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), '0'::text))::bigint) 
    AND (users.role = ANY (ARRAY['admin'::text, 'manager'::text, 'dispatcher'::text])))
  ))
);

alter policy "System can insert referral transactions" 
on "public"."referral_transactions"
to authenticated
with check (
  true
);

alter policy "Users can view own referral transactions" 
on "public"."referral_transactions"
to authenticated
using (
  ((referred_user_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), '0'::text))::bigint)) 
  OR 
  (referrer_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), '0'::text))::bigint)))
);

alter policy "Public can create user profile" 
on "public"."users"
to public
with check (
  true
);

alter policy "Users can update own profile" 
on "public"."users"
to public
using (
  (user_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), '0'::text))::bigint))
)
with check (
  (user_id = (COALESCE(NULLIF(current_setting('app.current_user_id'::text, true), '0'::text))::bigint))
);

alter policy "Users can view own profile" 
on "public"."users"
to public
using (
  true
);