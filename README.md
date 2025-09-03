# Challenge – NestJS + TypeORM

Este repositorio contiene la solución al challenge técnico, implementada en **NestJS** con **TypeORM** y una base de datos **PostgreSQL**.  

El objetivo fue resolver la problemática propuesta de manera clara y funcional, pero también me permití experimentar con tecnologías adicionales y dejar documentado mi proceso de pensamiento.  

---

## 🚀 Tecnologías principales

- **NestJS**: framework elegido para estructurar la aplicación.
- **TypeORM**: ORM requerido para el challenge.  
- **PostgreSQL**: base de datos principal.  

---

## 🔍 Extras (no esenciales para el challenge)

Me gusta investigar y probar cosas nuevas, por eso incorporé algunas herramientas adicionales que no eran estrictamente necesarias pero aportaron valor al proceso:

- **ClickHouse**  
- **Debezium**  
- **Effect-TS**  

> Nota: estas integraciones son opcionales. Lo único realmente indispensable para correr el challenge es la base de datos PostgreSQL.

---

## 🐳 Docker Compose

El proyecto incluye un `docker-compose.yml` que levanta:  

- PostgreSQL (necesaria para la app).  
- ClickHouse.  
- Debezium Connect.  
- Zookeeper.  

Si bien están ahí para jugar y experimentar, la aplicación únicamente depende de **PostgreSQL**.  

---

## 📂 Archivos destacados

- **`entendimiento.sql`**  
  Este archivo es casi un “diario de desarrollo”. Documenta el razonamiento y pasos que me llevaron a la solución propuesta. Recomiendo leerlo porque refleja mejor cómo abordé la problemática.  

- **`API.md`** 
  Contiene ejemplos de como correr la api 
---

## ⚙️ Configuración y ejecución

1. Clonar el repositorio  
2. Instalar dependencias:  
   ```bash
   npm install
   ```  
3. Crear un archivo `.env` a partir de `.env.example`. Se puede usar tal cual está para conectarse al PostgreSQL de Docker.  
4. Levantar los servicios de Docker:  
   ```bash
   docker compose up -d
   ```  
5. El archivo `database.sql` tiene la version revisada de la base de datos con todas las correcciones y actualizaciones que surgieron de `entendimiento.sql`
6. Iniciar la aplicación Nest:  
   ```bash
   npm run start
   ```  

---

## 🧪 Tests

Para los tests me apoyé en **Claude Code**. Descubrí que funciona bien cuando uno ya tiene la estructura definida y sabe exactamente qué pedir. Si no, suele “inventar” bastante.  
De todas formas, me resultó útil para ahorrar tiempo en la parte de testing.  

```bash
   npm run test:e2e
```  

---

## 🤓 Reflexión

- Este challenge me permitió aprender un poco de **NestJS** (que hasta ahora no había usado) y de **TypeORM** (que tampoco había usado pero es requerido para el pusto :P).  
- Soy bastante particular con los ORMs… debo decir que he usado peores 😅.  
- Disfruté pensar la problemática y tratar de resolverla con un toque divertido.  
- Me entretuve mucho probando tecnologías paralelas, aunque debería haber arrancado con lo esencial antes de jugar tanto.  

---

## 👨‍💻 Autor

Desarrollado por **Nicolás Gallinal** como parte del proceso de selección en **Cocos**.  
