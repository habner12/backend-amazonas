const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');

const app = express();

app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { rejectUnauthorized: false }
});

// Inicialización segura de tablas y columnas
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error de conexión a MySQL:', err.message);
    } else {
        console.log('✅ Conexión exitosa a la base de datos MySQL');

        // 1. Crear tabla de Repartidores
        const createRepartidoresTable = `
            CREATE TABLE IF NOT EXISTS repartidores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nombre VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                vehiculo VARCHAR(100),
                placa VARCHAR(50),
                telefono VARCHAR(50),
                estado VARCHAR(50) DEFAULT 'Activo 🟢',
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `;

        // 2. Crear tabla de Pedidos
        const createPedidosTable = `
            CREATE TABLE IF NOT EXISTS pedidos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                cliente_nombre VARCHAR(255) NOT NULL,
                cliente_telefono VARCHAR(50) NOT NULL,
                direccion TEXT NOT NULL,
                latitud VARCHAR(50),
                longitud VARCHAR(50),
                horario_entrega VARCHAR(50),
                metodo_pago VARCHAR(50),
                propina DECIMAL(10, 2) DEFAULT 0,
                total DECIMAL(10, 2) NOT NULL,
                estado VARCHAR(50) DEFAULT 'Recibido ⏳',
                repartidor_id INT NULL,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `;

        connection.query(createRepartidoresTable, (err) => {
            if (err) console.error('Error creando tabla repartidores:', err.message);
            
            connection.query(createPedidosTable, (err) => {
                if (err) console.error('Error creando tabla pedidos:', err.message);

                // 3. Forzar adición de la columna repartidor_id si no existía previamente
                const addColumnQuery = `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS repartidor_id INT NULL;`;
                connection.query(addColumnQuery, (err) => {
                    connection.release();
                    if (err) console.error('Error asegurando columna repartidor_id:', err.message);
                    else console.log('✅ Base de datos verificada y estructurada correctamente');
                });
            });
        });
    }
});

// Ruta raíz
app.get('/', (req, res) => {
    res.json({ message: 'API de AMAZONAS funcionando correctamente 🚀' });
});

// ==========================================
// RUTAS CLIENTE
// ==========================================

// Crear pedido
app.post('/api/pedidos', (req, res) => {
    const { cliente_nombre, cliente_telefono, direccion, latitud, longitud, horario_entrega, metodo_pago, propina, total } = req.body;

    if (!cliente_nombre || !cliente_telefono || !direccion || !total) {
        return res.status(400).json({ error: 'Faltan datos obligatorios para el pedido' });
    }

    const sql = `
        INSERT INTO pedidos (cliente_nombre, cliente_telefono, direccion, latitud, longitud, horario_entrega, metodo_pago, propina, total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    pool.query(sql, [
        cliente_nombre, 
        cliente_telefono, 
        direccion, 
        latitud || '', 
        longitud || '', 
        horario_entrega || 'Inmediata', 
        metodo_pago || 'Efectivo', 
        propina || 0, 
        total
    ], (err, results) => {
        if (err) {
            console.error('Error insertando el pedido:', err);
            return res.status(500).json({ error: 'Error al registrar el pedido' });
        }
        res.status(201).json({ success: true, pedido_id: results.insertId });
    });
});

// Consultar estado de pedido por ID
app.get('/api/pedidos/:id', (req, res) => {
    const { id } = req.params;
    const sql = `
        SELECT p.*, COALESCE(r.nombre, 'Sin asignar') as repartidor_nombre, r.telefono as repartidor_telefono 
        FROM pedidos p 
        LEFT JOIN repartidores r ON p.repartidor_id = r.id 
        WHERE p.id = ?
    `;
    pool.query(sql, [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error al consultar pedido' });
        if (results.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
        res.json(results[0]);
    });
});

// ==========================================
// RUTAS ADMINISTRADOR
// ==========================================

// Listar todos los pedidos (Solución del error al cargar lista)
app.get('/api/admin/pedidos', (req, res) => {
    const sql = `
        SELECT 
            p.id, 
            COALESCE(p.cliente_nombre, 'Sin Nombre') AS cliente_nombre, 
            COALESCE(p.cliente_telefono, 'S/N') AS cliente_telefono, 
            COALESCE(p.direccion, 'Sin Dirección') AS direccion, 
            COALESCE(p.metodo_pago, 'Efectivo') AS metodo_pago, 
            COALESCE(p.total, 0) AS total, 
            COALESCE(p.estado, 'Recibido ⏳') AS estado,
            p.repartidor_id,
            COALESCE(r.nombre, 'Sin asignar') AS repartidor_nombre
        FROM pedidos p 
        LEFT JOIN repartidores r ON p.repartidor_id = r.id 
        ORDER BY p.id DESC
    `;
    pool.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Error consultando pedidos:', err);
            return res.status(500).json({ error: 'Error al consultar la lista de pedidos' });
        }
        res.setHeader('Content-Type', 'application/json');
        res.status(200).json(results);
    });
});

// Crear nuevo repartidor
app.post('/api/admin/repartidores', (req, res) => {
    const { nombre, email, password, vehiculo, placa, telefono } = req.body;

    if (!nombre || !email || !password) {
        return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
    }

    const sql = `INSERT INTO repartidores (nombre, email, password, vehiculo, placa, telefono) VALUES (?, ?, ?, ?, ?, ?)`;
    pool.query(sql, [nombre, email, password, vehiculo || '', placa || '', telefono || ''], (err, results) => {
        if (err) {
            console.error('Error registrando repartidor:', err);
            return res.status(500).json({ error: 'El email ya existe o hubo un error en la base de datos' });
        }
        res.status(201).json({ success: true, repartidor_id: results.insertId });
    });
});

// Listar todos los repartidores
app.get('/api/admin/repartidores', (req, res) => {
    pool.query('SELECT id, nombre, email, vehiculo, placa, telefono, estado FROM repartidores ORDER BY id DESC', (err, results) => {
        if (err) return res.status(500).json({ error: 'Error al consultar repartidores' });
        res.json(results);
    });
});

// Asignar pedido a un repartidor
app.patch('/api/admin/pedidos/:id/asignar', (req, res) => {
    const { id } = req.params;
    const { repartidor_id } = req.body;

    const sql = `UPDATE pedidos SET repartidor_id = ?, estado = 'En camino 🚚' WHERE id = ?`;
    pool.query(sql, [repartidor_id, id], (err) => {
        if (err) return res.status(500).json({ error: 'Error al asignar repartidor' });
        res.json({ success: true, message: 'Repartidor asignado correctamente' });
    });
});

// Actualizar estado general del pedido
app.patch('/api/admin/pedidos/:id', (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    pool.query('UPDATE pedidos SET estado = ? WHERE id = ?', [estado, id], (err) => {
        if (err) return res.status(500).json({ error: 'Error al actualizar el estado' });
        res.json({ success: true, message: 'Estado actualizado correctamente' });
    });
});

// ==========================================
// RUTAS DASHBOARD REPARTIDOR
// ==========================================

// Login de Repartidor
app.post('/api/repartidores/login', (req, res) => {
    const { email, password } = req.body;

    pool.query('SELECT id, nombre, email, vehiculo, placa, telefono FROM repartidores WHERE email = ? AND password = ?', [email, password], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (results.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas' });
        res.json({ success: true, repartidor: results[0] });
    });
});

// Obtener pedidos asignados a un repartidor específico
app.get('/api/repartidores/:id/pedidos', (req, res) => {
    const { id } = req.params;
    pool.query('SELECT * FROM pedidos WHERE repartidor_id = ? ORDER BY id DESC', [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error al consultar pedidos asignados' });
        res.json(results);
    });
});

process.on('uncaughtException', (err) => console.error('⚠️ Excepción no capturada:', err.message));
process.on('unhandledRejection', (err) => console.error('⚠️ Promesa rechazada no capturada:', err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});
