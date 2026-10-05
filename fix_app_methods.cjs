const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

const target1 = `  // Supabase Auth Listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (currentSession?.user) {
        // Hydrate from localStorage or use defaults
        const storedProfile = localStorage.getItem('plugos_profile');
        if (storedProfile) {
          setSession(JSON.parse(storedProfile));
        } else {
          // If no stored profile, we might need to fetch it or default to Owner
          // For MVP, we let WelcomeScreen handle the initial login which sets the profile.
          // But if they refresh, we need it. Let's just create a basic one.
          const basicSession: UserSession = {
            userId: currentSession.user.id,
            userName: currentSession.user.email?.split('@')[0] || 'User',
            role: 'OWNER',
            branchId: 'br-main',
            branchName: 'Main Branch',
            shiftId: \`SHIFT-\${Math.random().toString(36).substr(2, 6).toUpperCase()}\`,
            deviceId: 'DEV-' + Math.random().toString(36).substr(2, 4).toUpperCase(),
            permissions: ['POS_CREATE', 'PAYMENT_PROCESS', 'RECEIPT_PRINT']
          };
          setSession(basicSession);
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!currentSession) {
        setSession(null);
        localStorage.removeItem('plugos_profile');
      }
    });

    return () => subscription.unsubscribe();
  }, []);`;

const replacement1 = `  // Load Business Auth
  useEffect(() => {
    const storedBiz = localStorage.getItem('plugos_business_auth');
    if (storedBiz) {
      setBusinessAuth(JSON.parse(storedBiz));
    }

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (currentSession?.user) {
        const storedProfile = localStorage.getItem('plugos_profile');
        if (storedProfile) {
          setSession(JSON.parse(storedProfile));
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!currentSession) {
        setSession(null);
        setBusinessAuth(null);
        localStorage.removeItem('plugos_profile');
        localStorage.removeItem('plugos_business_auth');
      }
    });

    return () => subscription.unsubscribe();
  }, []);`;

const target2 = `  const handleLoginSuccess = async (newSession: UserSession) => {
    setSession(newSession);
    localStorage.setItem('plugos_profile', JSON.stringify(newSession));
    
    // Attempt basic remote sync for MVP (download profile data)
    try {
      const { data: staffData } = await supabase.from('staff_members').select('*').eq('auth_id', newSession.userId).single();
      if (staffData) {
        const { data: branchData } = await supabase.from('branches').select('*').eq('id', staffData.branch_id).single();
        if (branchData) {
          await sdk.storage.set('branches', branchData.id, branchData);
          await sdk.storage.set('businesses', branchData.business_id, { id: branchData.business_id });
        }
        await sdk.storage.set('staff', newSession.userId, staffData);
      }
      // Trigger reload of local state so the app reflects any downloaded data
      // (This is a naive MVP sync, full offline sync is ignored as requested)
    } catch (e) {
      console.warn('Sync failed or tables missing', e);
    }
  };`;

const replacement2 = `  const handleBusinessAuthSuccess = async (newBizAuth: BusinessAuthSession) => {
    setBusinessAuth(newBizAuth);
    localStorage.setItem('plugos_business_auth', JSON.stringify(newBizAuth));
    
    try {
      const { data: staffData } = await supabase.from('staff_members').select('*').eq('business_id', newBizAuth.businessId);
      if (staffData && staffData.length > 0) {
        const { data: branchData } = await supabase.from('branches').select('*').eq('business_id', newBizAuth.businessId);
        if (branchData) {
          for (const b of branchData) await sdk.storage.set('branches', b.id, b);
        }
        for (const s of staffData) await sdk.storage.set('staff', s.id, s);
        
        setShowSetupWizard(false);
      } else {
        if (newBizAuth.isOwner) {
          setShowSetupWizard(true);
        }
      }
    } catch (e) {
      console.warn('Sync failed or tables missing', e);
      if (newBizAuth.isOwner) {
        setShowSetupWizard(true);
      }
    }
  };

  const handleTerminalLoginSuccess = (newSession: UserSession) => {
    setSession(newSession);
    localStorage.setItem('plugos_profile', JSON.stringify(newSession));
  };`;

content = content.replace(target1, replacement1);
content = content.replace(target2, replacement2);

fs.writeFileSync('src/App.tsx', content);
