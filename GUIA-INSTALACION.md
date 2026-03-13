# 🚀 Spendly — Guía de Instalación Paso a Paso

> Esta guía está hecha para que puedas instalar Spendly sin saber nada de código.
> Seguí cada paso en orden y vas a tener tu app funcionando en menos de 30 minutos.

---

## 📋 Lo que vas a necesitar (todo gratis)

1. **Una cuenta de GitHub** → https://github.com (es como un Google Drive para código)
2. **Una cuenta de Vercel** → https://vercel.com (es donde va a vivir tu app)
3. **Una cuenta de Supabase** → https://supabase.com (es la base de datos donde se guardan tus gastos)

---

## PASO 1: Crear cuenta en GitHub

1. Andá a https://github.com
2. Hacé clic en **"Sign up"**
3. Seguí los pasos (email, contraseña, nombre de usuario)
4. Confirmá tu email

---

## PASO 2: Subir el código a GitHub

1. Una vez logueado en GitHub, hacé clic en el botón **"+"** (arriba a la derecha) → **"New repository"**
2. En **"Repository name"** escribí: `spendly`
3. Dejá seleccionado **"Public"**
4. **NO** marques ninguna otra opción (no readme, no gitignore, nada)
5. Hacé clic en **"Create repository"**
6. Te va a aparecer una página con instrucciones. **Dejala abierta**, la vas a necesitar.

### Subir los archivos:

**Opción A (la más fácil):**
1. Descargá todos los archivos que te doy en este zip
2. Descomprimí el zip en tu computadora
3. En la página de GitHub que dejaste abierta, hacé clic en **"uploading an existing file"**
4. Arrastrá TODOS los archivos y carpetas a la ventana
5. Hacé clic en **"Commit changes"**

**Opción B (si tenés Git instalado):**
```bash
git clone https://github.com/TU-USUARIO/spendly.git
cd spendly
# Copiá todos los archivos del proyecto acá
git add .
git commit -m "Initial commit"
git push origin main
```

---

## PASO 3: Crear la base de datos en Supabase

1. Andá a https://supabase.com y hacé clic en **"Start your project"**
2. Logueate con tu cuenta de GitHub (es lo más fácil)
3. Hacé clic en **"New project"**
4. Completá:
   - **Name:** `spendly`
   - **Database Password:** Elegí una contraseña SEGURA y **guardala en algún lado** (la vas a necesitar)
   - **Region:** Elegí la más cercana a vos (ej: East US si estás en América)
5. Hacé clic en **"Create new project"**
6. Esperá 1-2 minutos a que se cree

### Crear las tablas:

1. En el menú de la izquierda, hacé clic en **"SQL Editor"** (ícono de un rayo)
2. Hacé clic en **"New query"**
3. Copiá y pegá TODO el contenido del archivo `supabase/schema.sql` que te doy
4. Hacé clic en el botón **"Run"** (o apretá Ctrl+Enter)
5. Debería aparecer un mensaje de "Success"

### Conseguir las claves:

1. En el menú de la izquierda, hacé clic en **"Project Settings"** (ícono de engranaje, abajo)
2. Hacé clic en **"API"** en el submenú
3. Vas a ver dos valores que necesitás:
   - **Project URL** → Copialo (se ve como `https://xxxxx.supabase.co`)
   - **anon public key** → Copialo (es una cadena larga de letras y números)

**¡Guardá estos dos valores! Los vas a necesitar en el próximo paso.**

---

## PASO 4: Publicar en Vercel

1. Andá a https://vercel.com y hacé clic en **"Sign Up"**
2. Elegí **"Continue with GitHub"** y autorizá
3. Hacé clic en **"Add New..."** → **"Project"**
4. Buscá tu repositorio `spendly` y hacé clic en **"Import"**
5. **MUY IMPORTANTE** — En la sección **"Environment Variables"**, agregá estas dos variables:

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | (pegá el Project URL de Supabase) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (pegá el anon public key de Supabase) |

   Para cada una: escribí el nombre, pegá el valor, y hacé clic en **"Add"**

6. Hacé clic en **"Deploy"**
7. Esperá 2-3 minutos a que se construya
8. 🎉 **¡Listo!** Vercel te va a dar una URL tipo `spendly-xxx.vercel.app`

---

## PASO 5: Guardar la app en tu celular

### iPhone:
1. Abrí Safari y andá a tu URL de Vercel
2. Tocá el botón de **compartir** (cuadradito con flecha arriba)
3. Buscá y tocá **"Agregar a pantalla de inicio"**
4. Poné el nombre "Spendly" y tocá **"Agregar"**

### Android:
1. Abrí Chrome y andá a tu URL de Vercel
2. Tocá los **tres puntitos** (arriba a la derecha)
3. Tocá **"Agregar a pantalla de inicio"** o **"Instalar app"**
4. Confirmá

---

## 🎯 ¡Listo! Ya podés usar Spendly

La primera vez que abras la app:
1. Tocá **"Crear cuenta"**
2. Poné tu email y una contraseña
3. Confirmá tu email (revisá spam)
4. ¡Empezá a cargar tus gastos!

---

## ❓ Problemas comunes

**"Me dice que falta la URL de Supabase"**
→ Revisá que las Environment Variables en Vercel estén bien escritas. Andá a Settings → Environment Variables en tu proyecto de Vercel.

**"No me llega el email de confirmación"**
→ Revisá la carpeta de spam. En Supabase podés ir a Authentication → Settings para configurar emails.

**"La app no carga"**
→ Revisá en Vercel si el deploy fue exitoso (debería decir "Ready"). Si falló, mandame una captura del error.

**"Quiero cambiar el dominio"**
→ En Vercel → tu proyecto → Settings → Domains, podés agregar un dominio personalizado o cambiar el subdominio gratis.

---

## 🔄 ¿Querés hacer cambios en el futuro?

Si algún día querés que te modifique algo (colores, features, etc.), simplemente:
1. Volvé a hablarme y decime qué querés cambiar
2. Te doy el archivo modificado
3. Subilo a GitHub (editá el archivo directo en github.com)
4. Vercel se actualiza solo automáticamente

¡Así de fácil!
