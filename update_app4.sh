#!/bin/bash
awk '
/^\s*{\/\* Role Authentication Modal/ {
  print "      {/* 1. If not authenticated with business, show WelcomeScreen (Cloud/Pair Auth) */}"
  print "      {!businessAuth && ("
  print "        <WelcomeScreen onLoginSuccess={handleBusinessAuthSuccess} />"
  print "      )}"
  print ""
  print "      {/* 2. If business authenticated but setup needed */}"
  print "      {businessAuth && showSetupWizard && ("
  print "        <FirstTimeSetupWizard "
  print "          businessAuth={businessAuth as any}"
  print "          onComplete={async () => {"
  print "            // Reload local state from sdk"
  print "            try {"
  print "              // Basic reloading logic"
  print "              setShowSetupWizard(false);"
  print "            } catch (e) {}"
  print "          }}"
  print "        />"
  print "      )}"
  print ""
  print "      {/* 3. If business authenticated, setup complete, but no terminal session */}"
  print "      {businessAuth && !showSetupWizard && !session && ("
  print "        <RoleLoginModal"
  print "          onLoginSuccess={handleTerminalLoginSuccess}"
  print "          currentSession={null}"
  print "          staffList={staffList}"
  print "          branches={branches}"
  print "        />"
  print "      )}"
  print ""
  print "      {/* 4. OS Workspace */}"
  print "      {businessAuth && !showSetupWizard && session && ("
  skip = 1
  next
}

/^\s*<\/>/ && skip {
  print "        <>"
  skip = 0
  next
}

{
  if (!skip && !/^{\!session && \(/ && !/^\s*<WelcomeScreen onLoginSuccess/ && !/^\s*{\/\* OS Shell Header/ && !/^\s*{session && \(/ && !/^\s*}\)$/ && !/^\s*<\/div>$/ ) {
    print
  } else if (!skip && /^\s*<\/div>$/) {
    print "    </div>"
  } else if (skip) {
    // Ignore lines until </>
  }
}
' src/App.tsx > src/App_temp2.tsx
# Need to be very precise here... Let me do it with javascript or python instead for reliability
