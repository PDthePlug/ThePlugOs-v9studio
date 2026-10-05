#!/bin/bash
awk '
/^\s*\/\/ Supabase Auth Listener/ {
  print "  // Load Business Auth"
  print "  useEffect(() => {"
  print "    const storedBiz = localStorage.getItem(\"plugos_business_auth\");"
  print "    if (storedBiz) {"
  print "      setBusinessAuth(JSON.parse(storedBiz));"
  print "    }"
  print ""
  print "    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {"
  print "      if (currentSession?.user) {"
  print "        const storedProfile = localStorage.getItem(\"plugos_profile\");"
  print "        if (storedProfile) {"
  print "          setSession(JSON.parse(storedProfile));"
  print "        }"
  print "      }"
  print "    });"
  print ""
  print "    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {"
  print "      if (!currentSession) {"
  print "        setSession(null);"
  print "        setBusinessAuth(null);"
  print "        localStorage.removeItem(\"plugos_profile\");"
  print "        localStorage.removeItem(\"plugos_business_auth\");"
  print "      }"
  print "    });"
  print ""
  print "    return () => subscription.unsubscribe();"
  print "  }, []);"
  print ""
  print "  const handleBusinessAuthSuccess = async (newBizAuth: BusinessAuthSession) => {"
  print "    setBusinessAuth(newBizAuth);"
  print "    localStorage.setItem(\"plugos_business_auth\", JSON.stringify(newBizAuth));"
  print ""
  print "    try {"
  print "      const { data: staffData } = await supabase.from(\"staff_members\").select(\"*\").eq(\"business_id\", newBizAuth.businessId);"
  print "      if (staffData && staffData.length > 0) {"
  print "        const { data: branchData } = await supabase.from(\"branches\").select(\"*\").eq(\"business_id\", newBizAuth.businessId);"
  print "        if (branchData) {"
  print "          for (const b of branchData) await sdk.storage.set(\"branches\", b.id, b);"
  print "        }"
  print "        for (const s of staffData) await sdk.storage.set(\"staff\", s.id, s);"
  print "        setShowSetupWizard(false);"
  print "      } else {"
  print "        if (newBizAuth.isOwner) {"
  print "          setShowSetupWizard(true);"
  print "        }"
  print "      }"
  print "    } catch (e) {"
  print "      console.warn(\"Sync failed or tables missing\", e);"
  print "      if (newBizAuth.isOwner) {"
  print "        setShowSetupWizard(true);"
  print "      }"
  print "    }"
  print "  };"
  print ""
  print "  const handleTerminalLoginSuccess = (newSession: UserSession) => {"
  print "    setSession(newSession);"
  print "    localStorage.setItem(\"plugos_profile\", JSON.stringify(newSession));"
  print "  };"
  
  skip = 1
  next
}

/^\s*\/\/ Kernel Boot Sequence/ {
  skip = 0
}

{
  if (!skip) print
}
' src/App.tsx > src/App_temp.tsx
mv src/App_temp.tsx src/App.tsx
