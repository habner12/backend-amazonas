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
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error de conexión a MySQL:', err.message);
    } else {
        console.log('✅ Conexión exitosa a la base de datos MySQL');

        const createTableQuery = `
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
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `;

        connection.query(createTableQuery, (queryErr) => {
            connection.release();
            if (queryErr) {
                console.error('❌ Error al crear/verificar la tabla pedidos:', queryErr.message);
            } else {
                console.log('✅ Tabla "pedidos" lista y verificada');
            }
        });
    }
});

app.get('/', (req, res) => {
    res.json({ message: 'API de AMAZONAS funcionando correctamente 🚀' });
});

app.post('/api/pedidos', (req, res) => {
    const { cliente_nombre, cliente_telefono, direccion, latitud, longitud, horario_entrega, metodo_pago, propina, total } = req.body;

    if (!cliente_nombre || !cliente_telefono || !direccion || !total) {
        return res.status(400).json({ error: 'Faltan datos obligatorios para el pedido' });
    }

    const sql = `
        INSERT INTO pedidos (cliente_nombre, cliente_telefono, direccion, latitud, longitud, horario_entrega, metodo_pago, propina, total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    pool.query(sql, [cliente_nombre, cliente_telefono, direccion, latitud, longitud, horario_entrega, metodo_pago, propina || 0, total], (err, results) => {
        if (err) {
            console.error('Error insertando el pedido:', err);
            return res.status(500).json({ error: 'Error al registrar el pedido en la base de datos' });
        }
        res.status(201).json({ success: true, pedido_id: results.insertId });
    });
});

app.get('/api/admin/pedidos', (req, res) => {
    pool.query('SELECT * FROM pedidos ORDER BY id DESC', (err, results) => {
        if (err) {
            console.error('Error al obtener pedidos:', err);
            return res.status(500).json({ error: 'Error al consultar pedidos' });
        }
        res.json(results);
    });
});

app.get('/api/pedidos/:id', (req, res) => {
    const { id } = req.params;
    pool.query('SELECT * FROM pedidos WHERE id = ?', [id], (err, results) => {
        if (err) {
            console.error('Error al buscar el pedido:', err);
            return res.status(500).json({ error: 'Error al consultar el pedido' });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        res.json(results[0]);
    });
});

app.patch('/api/admin/pedidos/:id', (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    if (!estado) {
        return res.status(400).json({ error: 'Debe especificar el nuevo estado' });
    }

    pool.query('UPDATE pedidos SET estado = ? WHERE id = ?', [estado, id], (err, results) => {
        if (err) {
            console.error('Error actualizando el estado:', err);
            return res.status(500).json({ error: 'Error al actualizar el estado del pedido' });
        }
        res.json({ success: true, message: 'Estado actualizado correctamente' });
    });
});

process.on('uncaughtException', (err) => {
    console.error('⚠️ Excepción no capturada:', err.message);
});

process.on('unhandledRejection', (err) => {
    console.error('⚠️ Promesa rechazada no capturada:', err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});
