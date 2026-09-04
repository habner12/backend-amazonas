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

// Función auxiliar para agregar columnas sin error de sintaxis en MySQL
function agregarColumnaSiNoExiste(connection, tabla, columna, definicion, callback) {
    const checkSql = `
        SELECT COUNT(*) AS count 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = ? 
          AND COLUMN_NAME = ?
    `;
    
    connection.query(checkSql, [tabla, columna], (err, results) => {
        if (err) return callback(err);

        if (results[0].count === 0) {
            const alterSql = `ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`;
            connection.query(alterSql, (alterErr) => {
                if (alterErr) return callback(alterErr);
                console.log(`✅ Columna '${columna}' agregada a la tabla '${tabla}'.`);
                callback(null);
            });
        } else {
            callback(null);
        }
    });
}

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
                estado_pago VARCHAR(50) DEFAULT 'Pendiente ⏳',
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

                // Verificación y adición segura de columnas sin errores de SQL
                agregarColumnaSiNoExiste(connection, 'pedidos', 'repartidor_id', 'INT NULL', (err) => {
                    if (err) console.error('Error verificando columna repartidor_id:', err.message);

                    agregarColumnaSiNoExiste(connection, 'pedidos', 'estado_pago', "VARCHAR(50) DEFAULT 'Pendiente ⏳'", (err) => {
                        connection.release();
                        if (err) console.error('Error verificando columna estado_pago:', err.message);
                        else console.log('✅ Base de datos verificada y estructurada correctamente');
                    });
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

    const estadoInicialPago = (metodo_pago === 'Efectivo') ? 'Efectivo 💵' : 'Pendiente QR ⏳';

    const sql = `
        INSERT INTO pedidos (cliente_nombre, cliente_telefono, direccion, latitud, longitud, horario_entrega, metodo_pago, estado_pago, propina, total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    pool.query(sql, [
        cliente_nombre, 
        cliente_telefono, 
        direccion, 
        latitud || '', 
        longitud || '', 
        horario_entrega || 'Inmediata', 
        metodo_pago || 'Efectivo', 
        estadoInicialPago,
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

// Listar todos los pedidos
app.get('/api/admin/pedidos', (req, res) => {
    const sql = `SELECT * FROM pedidos ORDER BY id DESC`;

    pool.query(sql, (err, pedidos) => {
        if (err) {
            console.error('❌ Error crítico en MySQL al consultar pedidos:', err.message);
            return res.status(500).json({ error: 'Error al consultar la base de datos', detalle: err.message });
        }

        if (!pedidos || pedidos.length === 0) {
            return res.json([]);
        }

        pool.query('SELECT id, nombre FROM repartidores', (errRep, repartidores) => {
            if (errRep) {
                return res.json(pedidos);
            }

            const listaFormateada = pedidos.map(p => {
                const rep = repartidores.find(r => r.id === p.repartidor_id);
                return {
                    ...p,
                    repartidor_nombre: rep ? rep.nombre : 'Sin asignar'
                };
            });

            res.json(listaFormateada);
        });
    });
});

// Asignar pedido a un repartidor
app.patch('/api/admin/pedidos/:id/asignar', (req, res) => {
    const { id } = req.params;
    const { repartidor_id } = req.body;

    const repId = (repartidor_id === "" || repartidor_id === null) ? null : parseInt(repartidor_id);
    const nuevoEstado = repId ? 'En camino 🚚' : 'Recibido ⏳';

    const sql = `UPDATE pedidos SET repartidor_id = ?, estado = ? WHERE id = ?`;
    pool.query(sql, [repId, nuevoEstado, id], (err) => {
        if (err) {
            console.error("Error al asignar repartidor:", err);
            return res.status(500).json({ error: 'Error al asignar repartidor' });
        }
        res.json({ success: true, message: 'Repartidor actualizado correctamente' });
    });
});

// Confirmar o cambiar estado de pago (QR / Efectivo)
app.patch('/api/admin/pedidos/:id/pago', (req, res) => {
    const { id } = req.params;
    const { estado_pago } = req.body;

    pool.query('UPDATE pedidos SET estado_pago = ? WHERE id = ?', [estado_pago, id], (err) => {
        if (err) return res.status(500).json({ error: 'Error al actualizar el pago' });
        res.json({ success: true, message: 'Estado de pago actualizado' });
    });
});

// Actualizar estado del pedido
app.patch('/api/admin/pedidos/:id/estado', (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    pool.query('UPDATE pedidos SET estado = ? WHERE id = ?', [estado, id], (err) => {
        if (err) return res.status(500).json({ error: 'Error al actualizar el estado' });
        res.json({ success: true, message: 'Estado actualizado correctamente' });
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

// ==========================================
// RUTAS DASHBOARD REPARTIDOR
// ==========================================

// Login de Repartidor (soporta llamadas a /api/repartidores/login y /api/repartidor/login)
const handleRepartidorLogin = (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Correo y contraseña requeridos' });
    }

    pool.query(
        'SELECT id, nombre, email, vehiculo, placa, telefono FROM repartidores WHERE email = ? AND password = ?',
        [email, password],
        (err, results) => {
            if (err) {
                console.error('Error en login de repartidor:', err);
                return res.status(500).json({ success: false, error: 'Error en el servidor' });
            }
            if (results.length === 0) {
                return res.status(401).json({ success: false, error: 'Correo o contraseña incorrectos' });
            }
            res.json({ success: true, repartidor: results[0] });
        }
    );
};

app.post('/api/repartidores/login', handleRepartidorLogin);
app.post('/api/repartidor/login', handleRepartidorLogin);

// Obtener pedidos asignados a un repartidor específico
const handleObtenerPedidosRepartidor = (req, res) => {
    const repartidorId = req.params.id || req.params.repartidorId;

    pool.query('SELECT * FROM pedidos WHERE repartidor_id = ? ORDER BY id DESC', [repartidorId], (err, results) => {
        if (err) {
            console.error('Error al obtener pedidos del repartidor:', err);
            return res.status(500).json({ success: false, error: 'Error al consultar pedidos asignados' });
        }
        res.json(results);
    });
};

app.get('/api/repartidores/:id/pedidos', handleObtenerPedidosRepartidor);
app.get('/api/repartidor/pedidos/:repartidorId', handleObtenerPedidosRepartidor);

// Manejo global de errores descontrolados
process.on('uncaughtException', (err) => console.error('⚠️ Excepción no capturada:', err.message));
process.on('unhandledRejection', (err) => console.error('⚠️ Promesa rechazada no capturada:', err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});