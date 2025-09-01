const { DataTypes } = require('sequelize');


/**
 * User Model for MySQL
 * @param {import("sequelize").Sequelize} sequelize
 * @returns {import("sequelize").Model}
 */ 
module.exports = (sequelize) => {
    return sequelize.define("Config", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        plugin_name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        config_key: {
            type: DataTypes.STRING,
            allowNull: false
        },
        config_value: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        context: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'shared'
        }
    }, {
        tableName: "configs",
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            {
                name: 'idx_plugin_context',
                unique: true,
                fields: ['plugin_name', 'config_key', 'context']
            }
        ]
    });
};