# Quick Start Guide - Multi-Location System

## 🚀 Getting Started in 5 Minutes

### Step 1: Deploy the Code
```bash
cd /Users/taylanwhite/bundtmarketer-app/web
npm install
npm run dev
```

### Step 2: Create First Admin User
1. Open http://localhost:5173
2. Click "Sign Up"
3. Create account with your email
4. **Important**: Copy your user ID from the URL or browser console

### Step 3: Make Yourself Admin
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: `bundtmarketer`
3. Go to **Firestore Database**
4. Navigate to `users` collection
5. Find your user document (by UID)
6. Click "Edit"
7. Add/modify these fields:
   ```
   isGlobalAdmin: true
   locationPermissions: []
   ```
8. Save

### Step 4: Apply Security Rules
1. In Firebase Console, go to **Firestore Database → Rules**
2. Copy contents from `FIRESTORE_SECURITY_RULES.txt`
3. Paste into rules editor
4. Click **Publish**

### Step 5: Create Your First Location
1. Refresh the app (you should now see admin menu)
2. Click **"Locations"** in the nav
3. Click **"+ New Location"**
4. Fill in:
   - Name: "Downtown Store" (or your location name)
   - Address, City, State, Zip (optional)
5. Click **"Create Location"**

### Step 6: Invite a User
1. Click **"Admin"** in the nav
2. In "Invite New User" section:
   - Email: `teammate@example.com`
   - Select your location
   - Check ☑ Can View
   - Check ☑ Can Edit
3. Click **"Send Invitation"**

### Step 7: Test User Signup
1. Open app in incognito/private window
2. Sign up with `teammate@example.com`
3. Verify they can access the location
4. Verify they can add contacts

## ✅ You're Done!

Your multi-location system is now ready to use.

---

## 📋 Common Tasks

### Add a New Location
1. **Admin** → **Locations** → **+ New Location**
2. Fill in details → **Create Location**

### Invite a User
1. **Admin** → **Admin Panel** → **Invite New User**
2. Enter email, select location, set permissions
3. **Send Invitation**

### Change User Permissions
1. **Admin** → **Admin Panel** → **Manage Users** table
2. Check/uncheck boxes for View/Edit per location
3. Changes save automatically

### Make Someone an Admin
1. **Admin** → **Admin Panel** → **Manage Users** table
2. Check the "Global Admin" box for that user
3. They now have full access

### Switch Locations (as User)
1. Look at the nav header
2. Find **📍 Location:** dropdown
3. Select different location
4. Dashboard updates to show that location's contacts

### Add a Contact
1. Select your location from dropdown
2. **Dashboard** → **+ Add Contact**
3. Use voice input or type manually
4. Click **🤖 Process with AI** if using raw notes
5. Fill in remaining fields
6. **Create Contact**

---

## 🔑 Permission Levels Explained

### Global Administrator
- ✅ See all locations
- ✅ Create/manage locations
- ✅ Invite/manage users
- ✅ View/edit all contacts everywhere

### Location User (Edit Permission)
- ✅ View contacts for assigned location(s)
- ✅ Add new contacts
- ✅ Edit existing contacts
- ✅ Add reachouts
- ❌ Cannot access admin features
- ❌ Cannot see other locations

### Location User (View Only)
- ✅ View contacts for assigned location(s)
- ✅ View reachout history
- ❌ Cannot add/edit contacts
- ❌ Cannot add reachouts
- ❌ Cannot access admin features

### No Permission
- ❌ Cannot access anything
- ➡️ Sees "No Access" page
- 📧 Must contact admin for access

---

## 🐛 Troubleshooting

### Problem: "No Access" page after login
**Solution**: 
- Admin needs to invite you
- Or admin needs to add permissions to your user document

### Problem: Can't see Admin menu
**Solution**:
- Check Firestore: `users/{yourUID}/isGlobalAdmin` must be `true`
- Refresh the page after changing

### Problem: Location dropdown is empty
**Solution**:
- Admin needs to create locations first
- Go to **Locations** page and create one

### Problem: Can't edit contacts
**Solution**:
- Check you have `canEdit: true` for the current location
- Admin can update this in Admin Panel

### Problem: Firestore permission denied errors
**Solution**:
- Ensure security rules are published
- Check rules match the template in `FIRESTORE_SECURITY_RULES.txt`
- Verify your permissions in Firestore

---

## 📚 Full Documentation

For complete details, see:
- **MULTI_LOCATION_SETUP.md** - Complete setup guide
- **IMPLEMENTATION_SUMMARY.md** - Technical implementation details
- **ARCHITECTURE_DIAGRAM.md** - Visual system architecture
- **FIRESTORE_SECURITY_RULES.txt** - Database security rules

---

## 🆘 Need Help?

1. Check browser console for errors
2. Verify Firestore rules are published
3. Check user document structure in Firestore
4. Ensure locations exist
5. Test with different user accounts

---

## 🎉 Success Checklist

- [ ] First admin user created
- [ ] Admin permissions set in Firestore
- [ ] Security rules published
- [ ] At least one location created
- [ ] Test user invited
- [ ] Test user can sign up and access
- [ ] Contacts can be created
- [ ] Location switching works
- [ ] Permissions are enforced correctly

**All checked?** You're ready to go! 🚀
