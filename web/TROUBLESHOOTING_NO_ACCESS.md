# Troubleshooting: "No Access" Page

## Quick Fix Steps

### 1. Log Out and Log Back In
The permissions are loaded when you log in. After setting `isGlobalAdmin: true` in Firestore:

1. Click **Logout** button (if visible)
2. Or go to: http://localhost:5173/login
3. Log in again with `taylanwhite@gmail.com`

### 2. Clear Browser Cache
Sometimes the old permission state is cached:

1. Open browser DevTools (F12 or Cmd+Option+I)
2. Go to **Application** tab → **Storage** → **Clear site data**
3. Or use **Hard Refresh**: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

### 3. Check Browser Console
1. Open DevTools (F12)
2. Go to **Console** tab
3. Look for any errors
4. Share any red error messages

### 4. Verify Firestore Document Structure
Your document should look like this in Firestore:

```
users/baaqoAfoukSV4pD2O5DksvdfbEU2:
  email: "taylanwhite@gmail.com"
  isGlobalAdmin: true
  locationPermissions: []
  createdAt: (timestamp)
  uid: "baaqoAfoukSV4pD2O5DksvdfbEU2"
```

✅ Your document looks correct! Just need to reload permissions.

## Common Issues

### Issue: Seeing "No Access" despite isGlobalAdmin: true
**Cause**: Permissions loaded before you set the admin flag
**Fix**: Log out and log back in

### Issue: Old "role: user" field exists
**Cause**: Old auth system used `role` field
**Fix**: The new system uses `isGlobalAdmin`, so ignore the `role` field

### Issue: Can't see logout button
**Fix**: Navigate directly to http://localhost:5173/login

## Debug Checklist

Run through these checks:

- [ ] Firestore document has `isGlobalAdmin: true`
- [ ] Firestore document has `locationPermissions: []` (empty array)
- [ ] Logged out and logged back in
- [ ] Cleared browser cache
- [ ] No errors in browser console
- [ ] Using the correct email to log in

## Still Not Working?

Add temporary debug logging to see what's happening:

1. Open browser console (F12)
2. On the "No Access" page, type:
```javascript
// Check localStorage
console.log('Auth state:', localStorage.getItem('firebase:authUser'))

// Check if user is authenticated
console.log('Current location:', window.location.href)
```

3. Share the output
